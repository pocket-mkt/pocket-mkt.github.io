import { useEffect, useState } from 'react';
import { publicHttpLink } from './progressBrief.js';

export default function DeadlineTaskLink({task,onResolve}) {
  const [state,setState]=useState({value:task.completionUrl,error:''});
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    let current=true;
    setState({value:task.completionUrl,error:''});
    if(task.completionUrl===undefined && onResolve) {
      Promise.resolve().then(()=>onResolve(task)).then(value=>{
        if(current)setState({value:value??'',error:''});
      },()=>{if(current)setState({value:undefined,error:'링크 조회 실패'});});
    }
    return ()=>{current=false;};
  },[task.id,task.projectId,task.completionUrl,task.updatedAt,onResolve,retry]);
  const href=publicHttpLink(state.value);
  if(href)return <span className="ops-completion-inline"><a className="ops-completion-link" href={href} target="_blank" rel="noopener noreferrer">열기 ↗</a><span className="ops-completion-url" title={state.value}>{state.value}</span></span>;
  if(state.error)return <span className="ops-completion-error" role="alert">조회 실패 <button type="button" onClick={()=>setRetry(value=>value+1)}>재시도</button></span>;
  return <span className="ops-completion-empty">{state.value===undefined?'불러오는 중…':state.value?'주소 확인 필요':'—'}</span>;
}
