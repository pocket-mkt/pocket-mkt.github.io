import { HubApiError } from '../api/errors.js';
import { withDetailReadTimeout } from './detailReadTimeout.js';

export function createDetailActivityReader(client) {
  return async ({ actorId = '', projectId = '', fromDate = '', toDate = '', actionCode = '', entityFilter = '', cursor, signal, limit = 100, workspaceNotifications = false } = {}) => {
    if(actionCode && !['CREATED','UPDATED','ARCHIVED','RESTORED'].includes(actionCode))throw new HubApiError('활동 필터가 올바르지 않습니다.',{code:'invalid_filter'});
    if(entityFilter && !['TASK','PROJECT_ISSUE','DAILY_MEETING','PROJECT'].includes(entityFilter))throw new HubApiError('유형 필터가 올바르지 않습니다.',{code:'invalid_filter'});
    if (actorId && actorId !== 'system' && !/^[0-9a-f-]{36}$/i.test(actorId)) throw new HubApiError('계정 필터가 올바르지 않습니다.', {code:'invalid_filter'});
    if (cursor && (!/^\d+$/.test(String(cursor.id)) || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(cursor.createdAt) || !Number.isFinite(Date.parse(cursor.createdAt)))) throw new HubApiError('조회 위치가 올바르지 않습니다.', {code:'invalid_cursor'});
    if (projectId && !/^[1-9]\d*$/.test(String(projectId))) throw new HubApiError('프로젝트 필터가 올바르지 않습니다.', {code:'invalid_filter'});
    for (const date of [fromDate,toDate]) if(date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)))) throw new HubApiError('날짜 필터가 올바르지 않습니다.', {code:'invalid_filter'});
    if(fromDate && toDate && fromDate>toDate) throw new HubApiError('시작일은 종료일 이전이어야 합니다.', {code:'invalid_filter'});
    const count = Math.max(1, Math.min(100, Number(limit) || 100));
    // Explicit browser-granted metadata only. Never select before_data/after_data.
    let query = client.from('activity_events').select('id,event_id,project_id,entity_type,entity_id,action_code,actor_user_id,actor_role_code,event_status_code,created_at,project:projects!activity_events_project_id_fkey(project_name)')
      .order('created_at', {ascending:false}).order('id', {ascending:false}).limit(count + 1);
    if (actorId === 'system') query = query.is('actor_user_id', null);
    else if (actorId) query = query.eq('actor_user_id', actorId);
    if(workspaceNotifications) query=query.in('entity_type',['TASK','PROJECT_ISSUE']).eq('action_code','CREATED').eq('event_status_code','COMMIT').gte('created_at',new Date(Date.now()-86400000).toISOString());
    if (projectId) query = query.eq('project_id',projectId);
    if(actionCode)query=query.eq('action_code',actionCode);
    if(entityFilter)query=query.eq('entity_type',entityFilter);
    if (fromDate) query = query.gte('created_at',new Date(`${fromDate}T00:00:00+09:00`).toISOString());
    if (toDate) query = query.lt('created_at',new Date(Date.parse(`${toDate}T00:00:00+09:00`)+86400000).toISOString());
    if (cursor) query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
    let accounts = client.from('profiles').select('id,display_name,organization_code').order('display_name');
    let projects = client.from('projects').select('id,project_name').order('project_name');
    if (signal) { query = query.abortSignal(signal); accounts = accounts.abortSignal(signal); projects=projects.abortSignal(signal); }
    const [events, profiles, projectList] = await Promise.all([query, accounts, projects]);
    const error = events.error || profiles.error || projectList.error;
    if (error) throw new HubApiError('세부로그를 불러오지 못했습니다. 연결 상태와 조회 권한을 확인해 주세요.', {code:error.code === '42501' ? 'forbidden' : 'detail_log_unavailable', cause:error});
    const items = events.data.slice(0,count);
    // Reuse the existing authorized, field-allowlisted task audit RPC. One
    // bounded request per represented project (max 3 concurrent), never raw JSON.
    const groups = new Map();
    for(const item of items) if(item.entity_type==='TASK' && item.event_status_code==='COMMIT') {
      const group=groups.get(String(item.project_id))||[];group.push(item);groups.set(String(item.project_id),group);
    }
    const pending=[...groups.values()];
    await Promise.all(Array.from({length:Math.min(3,pending.length)},async()=>{
      while(pending.length && !signal?.aborted) {
        const rows=pending.shift();
        try {
          const byId=new Map();
          let cursor={createdAt:rows[0].created_at,id:String(BigInt(rows[0].id)+1n)};
          for(let page=0;page<5 && cursor;page++) {
            const data=await readTaskEventPage(client,rows[0],200,signal,cursor);
            for(const detail of data.items)byId.set(String(detail.event_id),detail);
            if(rows.every(row=>byId.has(String(row.event_id))))break;
            cursor=data.nextCursor;
          }
          for(const row of rows) {row.task_detail=byId.get(String(row.event_id))||null;if(!row.task_detail)row.detail_error_code='detail_not_found';}
        } catch(error) { for(const row of rows) {row.task_detail=null;row.detail_unavailable=true;row.detail_error_code=error.code||'detail_log_unavailable';} }
      }
    }));
    // Current issue content and fallback task names are automatic, batched by
    // project. They are explicitly not historical audit snapshots.
    if(!workspaceNotifications) {
      const contextGroups=new Map();
      for(const row of items)if(row.entity_type==='PROJECT_ISSUE'||(row.entity_type==='TASK'&&!row.task_detail)) {
        const rows=contextGroups.get(String(row.project_id))||[];rows.push(row);contextGroups.set(String(row.project_id),rows);
      }
      const pendingContexts=[...contextGroups.values()];
      await Promise.all(Array.from({length:Math.min(3,pendingContexts.length)},async()=>{
        while(pendingContexts.length&&!signal?.aborted) {
          const rows=pendingContexts.shift();
          try {
            const data=await readCurrentWorkspace(client,rows[0].project_id,signal);
            for(const row of rows) {
              if(row.entity_type==='TASK')row.task_current_title=data.items?.find(task=>String(task.task_id)===String(row.entity_id))?.title||null;
              else {
                const issue=data.issues?.find(issue=>String(issue.issue_id)===String(row.entity_id));
                if(issue)row.issue_context={relatedTask:issue.related_task_text,body:issue.body_text,kind:issue.kind_text};
                else row.issue_error_code='detail_not_found';
              }
            }
          } catch(error) {for(const row of rows)if(row.entity_type==='PROJECT_ISSUE')row.issue_error_code=error.code||'detail_log_unavailable';}
        }
      }));
    }
    const last = items.at(-1);
    return {ok:true,data:{items,actors:profiles.data,projects:projectList.data,nextCursor:events.data.length>count ? {id:String(last.id),createdAt:last.created_at} : null}};
  };
}

async function readTaskEventPage(client,event,limit,signal,cursor) {
  if(event.entity_type!=='TASK' || event.event_status_code!=='COMMIT' || !/^[1-9]\d*$/.test(String(event.id)) || !/^[1-9]\d*$/.test(String(event.project_id)) || !Number.isFinite(Date.parse(event.created_at))) throw new HubApiError('조회할 업무 기록이 올바르지 않습니다.',{code:'invalid_filter'});
  // Preserve original timestamp precision; rounding to JS milliseconds loses
  // events that share the same millisecond. Exclusive tuple cursor includes row.
  cursor ||= {createdAt:event.created_at,id:String(BigInt(event.id)+1n)};
  return withDetailReadTimeout(async requestSignal=>{
    let query=client.rpc('read_task_activity',{p_project_id:String(event.project_id),p_limit:limit,p_before_created_at:cursor.createdAt,p_before_id:String(cursor.id)});
    if(typeof query.abortSignal==='function')query=query.abortSignal(requestSignal);
    let {data,error}=await query;
    // Older deployed installations expose the original two-argument RPC.
    // Keep its own authorization, and still join only exact event UUIDs.
    if(['PGRST202','42883'].includes(error?.code)) {
      let legacy=client.rpc('read_task_activity',{p_project_id:String(event.project_id),p_limit:limit});
      if(typeof legacy.abortSignal==='function')legacy=legacy.abortSignal(requestSignal);
      ({data,error}=await legacy);
    }
    if(error || !Array.isArray(data?.items)) throw new HubApiError('변경 내역을 불러오지 못했습니다.',{code:error?.code||'invalid_contract'});
    return data;
  },signal);
}

export async function readDetailTaskEvent(client,event,signal) {
  const {items}=await readTaskEventPage(client,event,1,signal);
  const detail=items.find(row=>String(row.event_id)===String(event.event_id));
  if(!detail)throw new HubApiError('이 기록의 변경 내역을 찾지 못했습니다.',{code:'detail_log_unavailable'});
  return {ok:true,data:detail};
}

export async function readIssueActivityContext(client,event,signal) {
  if(event.entity_type!=='PROJECT_ISSUE' || !/^[1-9]\d*$/.test(String(event.entity_id)) || !/^[1-9]\d*$/.test(String(event.project_id)))throw new HubApiError('확인요청 기록이 올바르지 않습니다.',{code:'invalid_filter'});
  const data=await readCurrentWorkspace(client,event.project_id,signal);
  const issue=data.issues.find(item=>String(item.issue_id)===String(event.entity_id));
  if(!issue)throw new HubApiError('삭제되었거나 조회 권한이 없는 확인요청입니다.',{code:'detail_log_unavailable'});
  return {ok:true,data:{relatedTask:issue.related_task_text,body:issue.body_text,kind:issue.kind_text}};
}

async function readCurrentWorkspace(client,projectId,signal) {
  if(!/^[1-9]\d*$/.test(String(projectId)))throw new HubApiError('프로젝트 식별자 오류',{code:'invalid_filter'});
  return withDetailReadTimeout(async requestSignal=>{
    let request=client.rpc('read_task_workspace',{p_project_id:String(projectId),p_include_archived:false});
    if(typeof request.abortSignal==='function')request=request.abortSignal(requestSignal);
    const {data,error}=await request;
    if(error||!Array.isArray(data?.issues))throw new HubApiError('현재 내용을 조회하지 못했습니다.',{code:error?.code||'invalid_contract'});
    return data;
  },signal);
}
