import { useEffect, useRef, useState } from 'react';
import { publicHttpLink } from './progressBrief.js';

export default function DeadlineTaskLink({task,onResolve}) {
  const [state,setState]=useState({value:task.completionUrl,loading:false,error:''});
  const generation=useRef(0);
  useEffect(()=>{generation.current++;setState({value:task.completionUrl,loading:false,error:''});return ()=>{generation.current++;};},[task.id,task.projectId,task.completionUrl,task.updatedAt]);
  const href=publicHttpLink(state.value);
  if(href)return <a className="ops-completion-link" href={href} target="_blank" rel="noopener noreferrer">완료자료 열기 ↗</a>;
  if(state.value!==undefined&&!state.error)return <span className="ops-completion-empty">{state.value?'주소 확인 필요':'미등록'}</span>;
  return <span><button className="ops-completion-load" type="button" disabled={state.loading||!onResolve} onClick={async()=>{
    const current=++generation.current;setState(old=>({...old,loading:true,error:''}));
    try{const value=await onResolve(task);if(current===generation.current)setState({value:value??'',loading:false,error:''});}
    catch{if(current===generation.current)setState({value:undefined,loading:false,error:'링크 조회 실패'});}
  }}>{state.loading?'조회 중…':state.error?'다시 조회':'완료링크 확인'}</button>{state.error&&<small role="alert">{state.error}</small>}</span>;
}
