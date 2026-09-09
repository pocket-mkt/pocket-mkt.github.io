import { lazy, Suspense, useEffect, useState } from 'react';
import { tasksViewModel } from './api/viewModel.js';
const IssueDetailModal=lazy(()=>import('./OperationsDashboardView.jsx').then(module=>({default:module.IssueDetailModal})));

export default function NotificationIssueDialog({request,source,canWrite,actorName,onUpdate,onArchive,onClose}) {
 const [state,setState]=useState({issue:null,error:''});
 const [retry,setRetry]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();setState({issue:null,error:''});
  Promise.resolve().then(()=>source.tasks({projectId:request.projectId,signal:controller.signal})).then(result=>{
   if(controller.signal.aborted)return;
   const issue=tasksViewModel(result).issues.find(item=>String(item.id)===String(request.id));
   if(!issue)throw Error('unavailable');
   setState({issue:{...issue,projectId:request.projectId,projectName:request.projectName,clientName:request.clientName||''},error:''});
  }).catch(()=>{if(!controller.signal.aborted)setState({issue:null,error:'확인요청을 열 수 없습니다. 삭제 여부 또는 접근 권한을 확인해 주세요.'});});
  return()=>controller.abort();
 },[source,request.id,request.projectId,retry]);
 const loading=<div className="ops-modal-backdrop"><section className="ops-modal" role="dialog" aria-modal="true" aria-label="확인요청 불러오기"><header><strong>{state.error||'확인요청을 불러오는 중입니다.'}</strong><button type="button" onClick={onClose}>닫기</button></header>{state.error&&<button type="button" onClick={()=>setRetry(value=>value+1)}>재시도</button>}</section></div>;
 return state.issue?<Suspense fallback={loading}><IssueDetailModal issue={state.issue} canWrite={canWrite} actorName={actorName} onUpdate={onUpdate} onArchive={onArchive} onClose={onClose}/></Suspense>:loading;
}
