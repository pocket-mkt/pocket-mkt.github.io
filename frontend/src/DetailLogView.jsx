import { useEffect, useState } from 'react';
import './detailLogView.css';
const entities = {TASK:'업무',PROJECT:'프로젝트',PROJECT_ISSUE:'확인요청',ISSUE:'확인요청',DAILY_MEETING:'회의록',PLAN:'실행계획',PROJECT_CREDENTIAL:'계정대장',PROFILE:'사용자',KPI:'성과',PROJECT_MEMBERSHIP:'권한'};
const actions = {CREATED:'생성',UPDATED:'수정',ARCHIVED:'삭제·보관',RESTORED:'복원',MIGRATED:'데이터 이전'};
const time = value => new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value));
export default function DetailLogView({ initialData, source }) {
  const [actorId,setActorId] = useState('');
  const [cursors,setCursors] = useState([null]);
  const [refresh,setRefresh] = useState(0);
  const [state,setState] = useState({data:initialData,loading:false,error:''});
  const cursor = cursors.at(-1);
  useEffect(()=>{
    if(!actorId && !cursor && !refresh) {setState({data:initialData,loading:false,error:''});return;}
    const controller = new AbortController(); let active=true;
    setState({data:null,loading:true,error:''});
    source.activity({actorId,cursor,limit:100,signal:controller.signal}).then(result=>{if(active)setState({data:result.data,loading:false,error:''});}).catch(error=>{if(active)setState({data:null,loading:false,error:error.message});});
    return ()=>{active=false;controller.abort();};
  },[source,initialData,actorId,cursor,refresh]);
  const accounts = state.data?.actors || initialData.actors || [];
  const actorName = id => id ? accounts.find(account=>account.id===id)?.display_name || '조회 권한 없는 계정' : '시스템';
  return <div className="detail-log-view"><header><h1>세부 로그</h1><p>접근 권한이 있는 모든 프로젝트의 작업 이력 · 최신순 · 한국시간</p></header>
    <section className="detail-log-toolbar"><label>작업한 로그인 계정<select value={actorId} onChange={event=>{setActorId(event.target.value);setCursors([null]);}}><option value="">전체 계정</option><option value="system">시스템</option>{accounts.map(account=><option key={account.id} value={account.id}>{account.display_name} · {account.organization_code} · {account.id.slice(-4)}</option>)}</select></label><button onClick={()=>setRefresh(value=>value+1)} disabled={state.loading}>새로고침</button></section>
    <p className="detail-log-note">계정별 작업 기록입니다. 로그인·로그아웃 접속 기록은 포함하지 않습니다. 비밀번호와 원본 변경 데이터는 표시하지 않습니다.</p>
    {state.error ? <div role="alert" className="detail-log-empty">{state.error}<button onClick={()=>setRefresh(value=>value+1)}>다시 시도</button></div> : state.loading ? <div className="detail-log-empty" role="status">로그를 불러오는 중입니다.</div> : <><div className="detail-log-table-wrap"><table><thead><tr><th>일시</th><th>로그인 계정</th><th>프로젝트</th><th>대상</th><th>작업</th><th>처리 결과</th><th>상세</th></tr></thead><tbody>{(state.data?.items||[]).map(item=><tr key={item.id}><td><time>{time(item.created_at)}</time></td><td><strong>{actorName(item.actor_user_id)}</strong></td><td>{item.project?.project_name || '프로젝트'}</td><td>{entities[item.entity_type]||item.entity_type}</td><td><span className={`detail-log-action is-${item.action_code.toLowerCase()}`}>{actions[item.action_code]||item.action_code}</span></td><td>{({COMMIT:'저장 완료',PREPARE:'처리 준비',FAILED:'실패'})[item.event_status_code]||item.event_status_code}</td><td><details><summary>식별정보</summary><small>기록 #{item.id}<br/>대상 #{item.entity_id || '—'}<br/>계정 {item.actor_user_id || '시스템'}</small></details></td></tr>)}</tbody></table>{!state.data?.items?.length&&<div className="detail-log-empty">해당 계정의 조회 가능한 작업 기록이 없습니다.</div>}</div><footer><button disabled={cursors.length===1} onClick={()=>setCursors(items=>items.slice(0,-1))}>이전</button><span>{cursors.length}페이지 · {state.data?.items?.length||0}건</span><button disabled={!state.data?.nextCursor} onClick={()=>setCursors(items=>[...items,state.data.nextCursor])}>다음 100건</button></footer></>}
  </div>;
}
