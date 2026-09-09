import { useEffect, useState } from 'react';
import { activityListViewModel } from './api/viewModel.js';
import './detailLogView.css';
const entities={TASK:'업무',PROJECT:'프로젝트',PROJECT_ISSUE:'확인요청',ISSUE:'확인요청',DAILY_MEETING:'회의록',PLAN:'실행계획',PROJECT_CREDENTIAL:'계정대장',PROFILE:'사용자',KPI:'성과',PROJECT_MEMBERSHIP:'권한'};
const actions={CREATED:'생성',UPDATED:'수정',ARCHIVED:'삭제·보관',RESTORED:'복원',MIGRATED:'데이터 이전'};
const time=value=>Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value)):'일시 미상';
const valueText=(field,value)=>value===null||value===undefined||value===''?'미설정':String(value)+(field==='progress_percent'?'%':'');

function ChangeDetails({detail,created=false}) {
  const changes=activityListViewModel({data:{items:[detail]}}).items[0].changes;
  if(!changes.length)return <span>공개 가능한 필드의 변경 없음</span>;
  return <ul className="detail-log-changes">{changes.map(change=><li key={change.field}><b>{change.label}</b>{!created&&<><span className="detail-log-before">{valueText(change.field,change.before)}</span><span aria-label="변경 후">→</span></>}<strong>{valueText(change.field,change.after)}</strong></li>)}</ul>;
}

function detailError(code) {
  if(code==='42501')return '변경 내역 조회 권한이 없습니다. 관리자 권한 설정 확인이 필요합니다. (42501)';
  if(['PGRST202','42883'].includes(code))return '서버의 로그 조회 함수가 준비되지 않았습니다. 서버 설정 확인이 필요합니다. ('+code+')';
  if(code==='detail_timeout'||code==='57014')return '상세 조회 시간이 초과되었습니다. 서버 응답을 확인해 주세요.';
  if(code==='detail_not_found')return '저장 당시의 상세 내역을 조회 범위에서 찾지 못했습니다.';
  return '상세 조회에 실패했습니다. 기록 자체는 남아 있으며 연결·서버 상태 확인이 필요합니다.';
}

function IssueActivityContent({item}) {
  const data=item.issue_context;
  return data?<div><strong>{data.relatedTask||data.kind||'확인요청'}</strong><p style={{whiteSpace:'pre-wrap'}}>{data.body||'내용 없음'}</p><small>현재 저장된 내용입니다. 생성·수정 당시의 원문이 아닐 수 있습니다.</small></div>:<span className="detail-log-muted" role="status">{item.issue_error_code==='detail_not_found'?'삭제되었거나 조회할 수 없는 확인요청입니다. 활동 기록은 유지됩니다.':detailError(item.issue_error_code)}</span>;
}

function LogRow({item,actorName}) {
  const detail=item.task_detail;
  const isTask=item.entity_type==='TASK' && item.event_status_code==='COMMIT';
  return <tr><td><time dateTime={item.created_at}>{time(item.created_at)}</time></td><td><strong>{actorName}</strong>{!item.actor_user_id&&<small>자동 처리</small>}</td><td><strong>{item.project?.project_name||'프로젝트'}</strong><small>{entities[item.entity_type]||item.entity_type}</small></td><td className="detail-log-task"><strong>{detail?.task_title || item.task_current_title || (entities[item.entity_type]||'항목')+' #'+(item.entity_id||'—')}</strong>{!detail?.task_title&&item.task_current_title&&<small>현재 업무명 · 변경 당시 이름과 다를 수 있음</small>}<small><span className={'detail-log-action is-'+String(item.action_code).toLowerCase()}>{actions[item.action_code]||item.action_code}</span> · {({COMMIT:'저장 완료',PREPARE:'처리 준비',FAILED:'실패'})[item.event_status_code]||item.event_status_code}</small></td><td className="detail-log-diff">{detail?<ChangeDetails detail={detail} created={item.action_code==='CREATED'}/>:isTask?<span className="detail-log-muted" role="status">{detailError(item.detail_error_code)}</span>:item.entity_type==='PROJECT_ISSUE'?<IssueActivityContent item={item}/>:<span className="detail-log-muted">{entities[item.entity_type]||'항목'} {actions[item.action_code]||'활동'} 기록</span>}</td></tr>;
}

export default function DetailLogView({initialData={},source}) {
  const [filters,setFilters]=useState({actorId:'',projectId:'',fromDate:'',toDate:'',actionCode:'',entityFilter:''});
  const [cursors,setCursors]=useState([null]);
  const [refresh,setRefresh]=useState(0);
  const [state,setState]=useState({data:initialData,loading:false,error:''});
  const cursor=cursors.at(-1);
  const changeFilter=(name,value)=>{setFilters(previous=>({...previous,[name]:value}));setCursors([null]);};
  useEffect(()=>{
    if(!Object.values(filters).some(Boolean)&&!cursor&&!refresh){setState({data:initialData,loading:false,error:''});return;}
    const controller=new AbortController();let active=true;
    setState({data:null,loading:true,error:''});
    source.activity({...filters,cursor,limit:100,signal:controller.signal}).then(result=>{if(active)setState({data:result.data,loading:false,error:''});}).catch(error=>{if(active)setState({data:null,loading:false,error:error.message});});
    return ()=>{active=false;controller.abort();};
  },[source,initialData,filters,cursor,refresh]);
  const accounts=state.data?.actors||initialData.actors||[];
  const projects=state.data?.projects||initialData.projects||[];
  const actorName=id=>id?accounts.find(account=>account.id===id)?.display_name||'조회 권한 없는 계정':'시스템';
  const items=state.data?.items||[];
  const committed=items.filter(item=>item.event_status_code==='COMMIT' && item.entity_type==='TASK');
  const summary=new Map();
  for(const item of committed){const key=item.project_id+':'+item.actor_user_id;const group=summary.get(key)||{name:item.project?.project_name||'프로젝트',actor:actorName(item.actor_user_id),tasks:new Set(),count:0};group.tasks.add(item.entity_id);group.count++;summary.set(key,group);}
  return <div className="detail-log-view"><header><h1>세부 로그</h1><p>계정별 업무·확인요청 생성, 수정, 삭제 등 활동을 확인합니다.</p></header>
    <section className="detail-log-toolbar"><label>작업한 로그인 계정<select value={filters.actorId} onChange={event=>changeFilter('actorId',event.target.value)}><option value="">전체 계정</option><option value="system">시스템</option>{accounts.map(account=><option key={account.id} value={account.id}>{account.display_name} · {account.organization_code} · {account.id.slice(-4)}</option>)}</select></label><label>프로젝트<select value={filters.projectId} onChange={event=>changeFilter('projectId',event.target.value)}><option value="">전체 프로젝트</option>{projects.map(project=><option key={project.id} value={project.id}>{project.project_name}</option>)}</select></label><label>활동<select value={filters.actionCode} onChange={event=>changeFilter('actionCode',event.target.value)}><option value="">전체 활동</option><option value="CREATED">생성</option><option value="UPDATED">수정</option><option value="ARCHIVED">삭제·보관</option><option value="RESTORED">복원</option></select></label><label>유형<select value={filters.entityFilter} onChange={event=>changeFilter('entityFilter',event.target.value)}><option value="">전체 유형</option><option value="TASK">업무</option><option value="PROJECT_ISSUE">확인요청</option><option value="DAILY_MEETING">회의록</option><option value="PROJECT">프로젝트</option></select></label><label>시작일<input type="date" value={filters.fromDate} onChange={event=>changeFilter('fromDate',event.target.value)}/></label><label>종료일<input type="date" value={filters.toDate} onChange={event=>changeFilter('toDate',event.target.value)}/></label><button onClick={()=>setRefresh(value=>value+1)} disabled={state.loading}>새로고침</button></section>
    <p className="detail-log-note">최신순 · 한국시간 · 아래 집계는 현재 페이지 최대 100건 기준입니다. 수정 횟수는 실제 작업시간·성과가 아닙니다. 로그인 기록과 비밀번호는 표시하지 않습니다.</p>
    {state.error?<div role="alert" className="detail-log-empty">{state.error}<button onClick={()=>setRefresh(value=>value+1)}>다시 시도</button></div>:state.loading?<div className="detail-log-empty" role="status">작업 내역을 불러오는 중입니다.</div>:<>
      <section className="detail-log-work-summary"><strong>현재 페이지 활동</strong><span>업무 생성 {items.filter(item=>item.entity_type==='TASK'&&item.action_code==='CREATED'&&item.event_status_code==='COMMIT').length}건</span><span>확인요청 생성 {items.filter(item=>item.entity_type==='PROJECT_ISSUE'&&item.action_code==='CREATED'&&item.event_status_code==='COMMIT').length}건</span><span>수정 {items.filter(item=>item.action_code==='UPDATED'&&item.event_status_code==='COMMIT').length}건</span><span>업무 저장 {committed.length}건</span><span>서로 다른 업무 {new Set(committed.map(item=>item.project_id+':'+item.entity_id)).size}개</span><small>자동 처리 포함 · 기간 전체 합계가 아닌 현재 페이지 기준</small><div>{[...summary].map(([key,group])=><span key={key}>{group.name} · {group.actor} <b>{group.tasks.size}개 업무 / {group.count}회 저장</b></span>)}</div></section>
      <div className="detail-log-table-wrap"><table><thead><tr><th>활동 일시</th><th>작업한 계정</th><th>프로젝트 / 구분</th><th>대상 / 활동</th><th>생성 내용 · 변경 내역</th></tr></thead><tbody>{items.map(item=><LogRow key={item.id+':'+refresh} item={item} actorName={actorName(item.actor_user_id)} source={source}/>)}</tbody></table>{!items.length&&<div className="detail-log-empty">선택한 조건의 조회 가능한 작업 기록이 없습니다.</div>}</div>
      <footer><button disabled={cursors.length===1} onClick={()=>setCursors(values=>values.slice(0,-1))}>이전</button><span>{cursors.length}페이지 · {items.length}건</span><button disabled={!state.data?.nextCursor} onClick={()=>setCursors(values=>[...values,state.data.nextCursor])}>다음 100건</button></footer>
    </>}
  </div>;
}
