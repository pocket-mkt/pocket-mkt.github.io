import { HubApiError } from '../api/errors.js';

export function createDetailActivityReader(client) {
  return async ({ actorId = '', projectId = '', fromDate = '', toDate = '', cursor, signal, limit = 100, workspaceNotifications = false } = {}) => {
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
    if(workspaceNotifications) query=query.eq('entity_type','TASK').eq('action_code','CREATED').eq('event_status_code','COMMIT').gte('created_at',new Date(Date.now()-86400000).toISOString());
    if (projectId) query = query.eq('project_id',projectId);
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
          const data=await readTaskEventWindow(client,rows[0],200,signal);
          const byId=new Map(data.map(row=>[String(row.event_id),row]));
          for(const row of rows) row.task_detail=byId.get(String(row.event_id))||null;
        } catch { for(const row of rows) {row.task_detail=null;row.detail_unavailable=true;} }
      }
    }));
    const last = items.at(-1);
    return {ok:true,data:{items,actors:profiles.data,projects:projectList.data,nextCursor:events.data.length>count ? {id:String(last.id),createdAt:last.created_at} : null}};
  };
}

async function readTaskEventWindow(client,event,limit,signal) {
  if(event.entity_type!=='TASK' || event.event_status_code!=='COMMIT' || !/^[1-9]\d*$/.test(String(event.id)) || !/^[1-9]\d*$/.test(String(event.project_id)) || !Number.isFinite(Date.parse(event.created_at))) throw new HubApiError('조회할 업무 기록이 올바르지 않습니다.',{code:'invalid_filter'});
  // Preserve original timestamp precision; rounding to JS milliseconds loses
  // events that share the same millisecond. Exclusive tuple cursor includes row.
  let query=client.rpc('read_task_activity',{p_project_id:String(event.project_id),p_limit:limit,p_before_created_at:event.created_at,p_before_id:String(BigInt(event.id)+1n)});
  if(signal)query=query.abortSignal(signal);
  const {data,error}=await query;
  if(error || !Array.isArray(data?.items)) throw new HubApiError('변경 내역을 불러오지 못했습니다. 조회 권한과 연결 상태를 확인해 주세요.',{code:'detail_log_unavailable'});
  return data.items;
}

export async function readDetailTaskEvent(client,event,signal) {
  const items=await readTaskEventWindow(client,event,1,signal);
  const detail=items.find(row=>String(row.event_id)===String(event.event_id));
  if(!detail)throw new HubApiError('이 기록의 변경 내역을 찾지 못했습니다.',{code:'detail_log_unavailable'});
  return {ok:true,data:detail};
}
