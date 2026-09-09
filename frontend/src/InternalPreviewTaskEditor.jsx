import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { tasksViewModel } from './api/viewModel.js';
const TaskEditModal=lazy(()=>import('./TaskWorkspace.jsx').then(module=>({default:module.TaskEditModal})));

// Only the internal preview wrapper receives a source/mutation callback. The
// client component and its safe projection remain read-only and unmodified.
export default function InternalPreviewTaskEditor({project,role,canWrite,source,onUpdate,children}) {
  const [task,setTask]=useState(null);
  const [mediaTasks,setMediaTasks]=useState([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const request=useRef(null);
  const allowed=['pocket','ns'].includes(role)&&canWrite&&typeof source?.tasks==='function'&&typeof onUpdate==='function';
  useEffect(()=>{setTask(null);setError('');setLoading(false);return ()=>request.current?.abort();},[project.id,role,canWrite,source]);
  const click=async event=>{
    if(!allowed||event.target.closest('a'))return;
    const summary=event.target.closest('.pb-flow-summary');
    if(!summary)return;
    const taskId=summary.closest('[data-flow-task-id]')?.dataset.flowTaskId;
    if(!taskId)return;
    event.preventDefault();event.stopPropagation();
    request.current?.abort();const controller=new AbortController();request.current=controller;
    setTask(null);setLoading(true);setError('');
    try {
      const response=await source.tasks({projectId:project.id,signal:controller.signal});
      if(controller.signal.aborted)return;
      const items=tasksViewModel(response).items;
      const canonical=items.find(item=>String(item.id)===String(taskId));
      if(!canonical)throw Error('missing task');
      setTask(canonical);
      setMediaTasks(items.map(({categoryCode,category})=>({categoryCode,category})));
    }catch{if(!controller.signal.aborted)setError('수정할 업무를 불러오지 못했습니다. 권한·삭제 여부를 확인하고 업무를 다시 눌러 주세요.');}
    finally{if(!controller.signal.aborted)setLoading(false);}
  };
  return <div onClickCapture={click}>{allowed&&<p className="panel-note">내부 계정 미리보기 · 업무를 클릭하면 수정합니다. 고객에게는 읽기 전용으로 표시됩니다.</p>}{children}{allowed&&loading&&<div className="modal-backdrop" role="status"><div className="screen-recovery">업무 수정 정보를 불러오는 중입니다.<button type="button" onClick={()=>{request.current?.abort();setLoading(false);}}>취소</button></div></div>}{allowed&&error&&<div className="modal-backdrop"><section className="screen-recovery" role="alertdialog" aria-label="업무 조회 실패"><p>{error}</p><button type="button" onClick={()=>setError('')}>닫기</button></section></div>}{allowed&&task&&<Suspense fallback={<p role="status">수정 팝업을 준비하는 중입니다.</p>}><TaskEditModal key={task.id} task={task} tasks={mediaTasks} clientName={project.clientName} onUpdate={onUpdate} onClose={()=>setTask(null)}/></Suspense>}</div>;
}
