import React,{useState} from 'react';
import PermissionsView from '../src/PermissionsView.jsx';
import {TaskScheduleTimeline} from '../src/TaskWorkspace.jsx';
import {taskMonthKey,shiftTaskMonth} from '../src/taskMonth.js';

export async function runAccessManagementQa(render,tick,check) {
  const projects=[{id:'A',clientName:'QA 첫 고객사',name:'운영'},{id:'B',clientName:'QA 메디',name:'온라인 캠페인'},{id:'C',clientName:'QA 신규',name:'온라인 캠페인'}];
  const account={id:'qa',account:'qa-client',displayName:'QA 담당자',enabled:true,accesses:[{id:'ma',projectId:'A',clientName:projects[0].clientName,projectName:projects[0].name,allowedPages:['progress','reports'],rowVersion:2},{id:'mb',projectId:'B',clientName:projects[1].clientName,projectName:projects[1].name,allowedPages:['reports'],rowVersion:7}]};
  let calls=[],fail=true,complete;
  const onSave=async data=>{calls.push(data);if(fail){fail=false;throw Error('QA 권한 저장 실패');}await new Promise(resolve=>{complete=resolve;});};
  const settle=async()=>{for(let i=0;i<4;i++)await tick();};
  const select=async id=>{const element=document.querySelector('[aria-label="접근 프로젝트"]');element.value=id;element.dispatchEvent(new Event('change',{bubbles:true}));await tick();};
  const box=label=>document.querySelector(`input[aria-label="${label}"]`);
  const submit=()=>document.querySelector('.access-account-modal form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  const confirm=window.confirm;window.confirm=()=>true;
  try {
    await render(<div/>);await render(<PermissionsView access={{projects,accounts:[account]}} role="pocket" onSave={onSave}/>);
    check(document.body.textContent.includes('QA 메디 · 온라인 캠페인'),'account list lacks company/project identity');
    document.querySelector('.access-account-row').click();await tick();
    check(box('진행상황 - 클라이언트').checked&&box('월별 마케팅 성과').checked,'first project grant not loaded');
    await select('B');
    check(!box('진행상황 - 클라이언트').checked&&box('월별 마케팅 성과').checked,'project switching retained previous pages');
    check(document.querySelector('[aria-label="접근 프로젝트"] option:checked').textContent==='QA 메디 · 온라인 캠페인','project selector lacks company identity');
    submit();await settle();check(calls.length===1&&calls[0].projectId==='B'&&calls[0].membershipId==='mb'&&calls[0].expectedRowVersion===7,'saved wrong project membership');
    check(calls[0].allowedPages.join(',')==='reports','reports-only grant got expanded');
    check(document.body.textContent.includes('QA 권한 저장 실패')&&box('월별 마케팅 성과').checked,'failed grant lost draft');
    submit();submit();await tick();check(calls.length===2,'duplicate permission save');complete();await settle();
    check(!document.querySelector('.access-account-modal'),'successful save did not close');
    document.querySelector('.access-account-row').click();await tick();await select('C');
    submit();await tick();check(calls.at(-1).projectId==='C'&&!calls.at(-1).membershipId&&!calls.at(-1).expectedRowVersion,'new assignment reused old membership/version');complete();await settle();
    await render(<div/>);await render(<PermissionsView access={{projects,accounts:[]}} role="ns" onSave={onSave}/>);
    [...document.querySelectorAll('button')].find(button=>button.textContent.includes('고객사 계정 생성')).click();await tick();
    check(document.querySelector('[aria-label="접근 프로젝트"]').value==='','new account silently chose first project');
    await select('B');
    check(box('월별 마케팅 성과')?.checked&&!box('KPI 성과'),'new grant choices mismatched current menus');
    check(!box('업무').checked&&!box('데일리 회의록').checked,'new account defaults include extra internal work');
    check(!document.body.textContent.includes('계정 비활성화'),'NS has global account disable action');
    const modal=document.querySelector('.access-account-modal'),footer=modal.querySelector('footer').getBoundingClientRect();
    check(modal.getBoundingClientRect().width<=innerWidth&&footer.bottom<=innerHeight+1,'permission modal/footer overflow');
    check(modal.querySelector('.access-modal-body').getBoundingClientRect().width>=modal.getBoundingClientRect().width-4,'global create-form grid compressed permission content');
    check(footer.width>=modal.getBoundingClientRect().width-4,'permission footer is not full width');
    check(document.documentElement.scrollWidth<=innerWidth+1,'permission page overflows');
    check(modal.querySelector('.access-modal-body').scrollHeight>=modal.querySelector('.access-modal-body').clientHeight,'permission content scroll missing');
    return ['customer/project labels, project-specific grants and versions, reports-only save, failed draft, duplicate guard, new assignment identity, NS boundary, visible footer'];
  } finally {window.confirm=confirm;}
}

export async function runMonthReorderQa(render,tick,check) {
  const current=taskMonthKey(new Date()),previous=shiftTaskMonth(current,-1),writes=[];
  const initial=[{id:'old',executionMonth:previous,sortOrder:10},{id:'a',executionMonth:current,sortOrder:20},{id:'old2',executionMonth:previous,sortOrder:30},{id:'b',executionMonth:current,sortOrder:40},{id:'c',executionMonth:current,sortOrder:50}].map(t=>({...t,title:'QA '+t.id,executionMonth:t.executionMonth+'-01',categoryCode:'NAVER',streamCode:'MARKETING',responsibleOrgCode:'NS',statusCode:'NOT_STARTED',scheduleDates:[current+'-03'],plannedStartDate:current+'-03',dueDate:current+'-03'}));
  function Fixture(){const [tasks,setTasks]=useState(initial),[mode,setMode]=useState('table');return <TaskScheduleTimeline tasks={tasks} issues={[]} project={{id:'reorder-month',clientName:'QA'}} query="" canWrite displayMode={mode} onViewChange={setMode} onBatchUpdate={async updates=>{writes.push(updates);setTasks(current=>current.map(task=>{const update=updates.find(item=>item.task.id===task.id);return update?{...task,sortOrder:update.fields.sort_order}:task;}));}}/>;}
  await render(<div/>);await render(<Fixture/>);
  const drag=async(sourceId,targetId)=>{
    const source=document.querySelector(`[data-window-id="${sourceId}"] .task-reorder-handle,[data-window-id="${sourceId}"] .g-reorder-handle`);
    check(source?.draggable,'month-only scope incorrectly blocks drag');
    const transfer=new DataTransfer();source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer}));await tick();
    const target=document.querySelector(`.reference-task-row[data-window-id="${targetId}"],.g-row[data-window-id="${targetId}"] .g-lbl`),bounds=target.getBoundingClientRect();
    target.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer,clientY:bounds.top+1}));await tick();
    target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));source.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:transfer}));
    for(let i=0;i<4;i++)await tick();
  };
  await drag('b','a');check(writes.length===1,'table drag did not save exactly once');
  check(writes[0].every(update=>!update.task.id.startsWith('old')),'drag changed another month');
  check([...document.querySelectorAll('.reference-task-row')].map(row=>row.dataset.windowId).join(',')==='b,a,c','saved table order reverted');
  [...document.querySelectorAll('.task-workspace-tabs button')].find(b=>b.textContent==='간트').click();await tick();
  await drag('a','b');check(writes.length===2,'Gantt drag did not save exactly once');
  check(writes.flat().every(update=>!update.task.id.startsWith('old')&&Object.keys(update.fields).every(key=>key==='sort_order')),'drag modified hidden task/month/dates');
  const ownerButtons=[...document.querySelectorAll('[aria-label="담당 업무별"] button')];
  ownerButtons.find(button=>button.textContent==='NS 업무').click();await tick();
  check([...document.querySelectorAll('.g-reorder-handle')].every(handle=>!handle.draggable),'detailed filter permits shared ordering');
  return ['current-month table/Gantt drag saves, stable order, untouched other months, detailed-filter protection'];
}
