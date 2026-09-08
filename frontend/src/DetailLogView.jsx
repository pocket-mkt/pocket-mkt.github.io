import { useEffect, useState } from 'react';
import { activityListViewModel } from './api/viewModel.js';
import './detailLogView.css';
const entities={TASK:'업무',PROJECT:'프로젝트',PROJECT_ISSUE:'확인요청',ISSUE:'확인요청',DAILY_MEETING:'회의록',PLAN:'실행계획',PROJECT_CREDENTIAL:'계정대장',PROFILE:'사용자',KPI:'성과',PROJECT_MEMBERSHIP:'권한'};
const actions={CREATED:'생성',UPDATED:'수정',ARCHIVED:'삭제·보관',RESTORED:'복원',MIGRATED:'데이터 이전'};
const time=value=>Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value)):'일시 미상';
const valueText=(field,value)=>value===null||value===undefined||value===''?'미설정':String(value)+(field==='progress_percent'?'%':'');

function ChangeDetails({detail}) {
  const changes=activityListViewModel({data:{items:[detail]}}).items[0].changes;
  if(!changes.length)return <span>공개 가능한 필드의 변경 없음</span>;
  return <ul className="detail-log-changes">{changes.map(change=><li key={change.field}><b>{change.label}</b><span className="detail-log-before">{valueText(change.field,change.before)}</span><span aria-label="변경 후">→</span><strong>{valueText(change.field,change.after)}</strong></li>)}</ul>;
}

function LogRow({item,actorName,source}) {
  const [detail,setDetail]=useState(item.task_detail);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{setDetail(item.task_detail);setError('');},[item]);
  const isTask=item.entity_type==='TASK' && item.event_status_code==='COMMIT';
  return <tr><td><time dateTime={item.created_at}>{time(item.created_at)}</time></td><td><strong>{actorName}</strong>{!item.actor_user_id&&<small>자동 처리</small>}</td><td><strong>{item.project?.project_name||'프로젝트'}</strong><small>{entities[item.entity_type]||item.entity_type}</small></td><td className="detail-log-task"><strong>{detail?.task_title || (entities[item.entity_type]||'항목')+' #'+(item.entity_id||'—')}</strong><small><span className={'detail-log-action is-'+String(item.action_code).toLowerCase()}>{actions[item.action_code]||item.action_code}</span> · {({COMMIT:'저장 완료',PREPARE:'처리 준비',FAILED:'실패'})[item.event_status_code]||item.event_status_code}</small></td><td className="detail-log-diff">{detail?<ChangeDetails detail={detail}/>:isTask?<><button disabled={loading} onClick={async()=>{setLoading(true);setError('');try{const result=await source.activity({detailEvent:item});setDetail(result.data);}catch{setError('변경 내역 조회 실패 — 다시 시도해 주세요.');}finally{setLoading(false);}}}>{loading?'불러오는 중…':'업무명 · 변경 내역 불러오기'}</button>{error&&<p role="alert">{error}</p>}</>:<span className="detail-log-muted">이 유형은 현재 작업 종류만 표시합니다.</span>}</td></tr>;
}

export default function DetailLogView({initialData={},source}) {
  const [filters,setFilters]=useState({actorId:'',projectId:'',fromDate:'',toDate:''});
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
  return <div className="detail-log-view"><header><h1>세부 로그</h1><p>누가 · 어느 프로젝트의 어떤 업무를 · 무엇에서 무엇으로 바꿨는지 확인합니다.</p></header>
    <section className="detail-log-toolbar"><label>작업한 로그인 계정<select value={filters.actorId} onChange={event=>changeFilter('actorId',event.target.value)}><option value="">전체 계정</option><option value="system">시스템</option>{accounts.map(account=><option key={account.id} value={account.id}>{account.display_name} · {account.organization_code} · {account.id.slice(-4)}</option>)}</select></label><label>프로젝트<select value={filters.projectId} onChange={event=>changeFilter('projectId',event.target.value)}><option value="">전체 프로젝트</option>{projects.map(project=><option key={project.id} value={project.id}>{project.project_name}</option>)}</select></label><label>시작일<input type="date" value={filters.fromDate} onChange={event=>changeFilter('fromDate',event.target.value)}/></label><label>종료일<input type="date" value={filters.toDate} onChange={event=>changeFilter('toDate',event.target.value)}/></label><button onClick={()=>setRefresh(value=>value+1)} disabled={state.loading}>새로고침</button></section>
    <p className="detail-log-note">최신순 · 한국시간 · 아래 집계는 현재 페이지 최대 100건 기준입니다. 수정 횟수는 실제 작업시간·성과가 아닙니다. 로그인 기록과 비밀번호는 표시하지 않습니다.</p>
    {state.error?<div role="alert" className="detail-log-empty">{state.error}<button onClick={()=>setRefresh(value=>value+1)}>다시 시도</button></div>:state.loading?<div className="detail-log-empty" role="status">작업 내역을 불러오는 중입니다.</div>:<>
      <section className="detail-log-work-summary"><strong>현재 페이지 작업량</strong><span>업무 저장 {committed.length}건</span><span>서로 다른 업무 {new Set(committed.map(item=>item.project_id+':'+item.entity_id)).size}개</span><small>자동 처리 포함 · 기간 전체 합계가 아닌 현재 페이지 기준</small><div>{[...summary].map(([key,group])=><span key={key}>{group.name} · {group.actor} <b>{group.tasks.size}개 업무 / {group.count}회 저장</b></span>)}</div></section>
      <div className="detail-log-table-wrap"><table><thead><tr><th>변경 일시</th><th>작업한 계정</th><th>프로젝트 / 구분</th><th>어떤 업무</th><th>변경 전 → 변경 후</th></tr></thead><tbody>{items.map(item=><LogRow key={item.id+':'+refresh} item={item} actorName={actorName(item.actor_user_id)} source={source}/>)}</tbody></table>{!items.length&&<div className="detail-log-empty">선택한 조건의 조회 가능한 작업 기록이 없습니다.</div>}</div>
      <footer><button disabled={cursors.length===1} onClick={()=>setCursors(values=>values.slice(0,-1))}>이전</button><span>{cursors.length}페이지 · {items.length}건</span><button disabled={!state.data?.nextCursor} onClick={()=>setCursors(values=>[...values,state.data.nextCursor])}>다음 100건</button></footer>
    </>}
  </div>;
}
