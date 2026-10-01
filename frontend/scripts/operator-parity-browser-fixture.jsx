import React,{useState} from 'react';
import {TasksView,DailyMeetingModal} from '../src/App.jsx';
import {TaskCreateModal} from '../src/TaskCreateModal.jsx';
import {taskMonthKey} from '../src/taskMonth.js';

export async function runOperatorParityQa(render,tick,check){
  const month=taskMonthKey(new Date()),writes=[];
  const task={id:'ns-task',title:'QA 고객 노출',categoryCode:'NAVER',streamCode:'MARKETING',responsibleOrgCode:'NS',statusCode:'IN_PROGRESS',visibilityCode:'CLIENT',executionMonth:month+'-01',plannedStartDate:month+'-01',dueDate:month+'-20',scheduleDates:[month+'-01'],rowVersion:1};
  const settle=async()=>{for(let i=0;i<8;i++)await tick();};
  function Fixture(){const [tasks,setTasks]=useState([task]);const save=async updates=>{writes.push(updates);setTasks(current=>current.map(t=>{const update=updates.find(u=>u.task.id===t.id);return update?{...t,visibilityCode:update.fields.visibility_code||t.visibilityCode}:t;}));};return <TasksView role="ns" canWrite query="" taskPage={{items:tasks,project:{id:'parity',clientName:'QA',rowVersion:2,startDate:month+'-01'}}} onBatchUpdate={save} onUpdate={(task,fields)=>save([{task,fields}])}/>;}
  await render(<div/>);await render(<Fixture/>);await settle();
  check(document.querySelector('.schedule-start-date'),'NS lacks project start-date control');
  document.querySelector('.reference-task-row input[type=checkbox]').click();await tick();
  const visibility=document.querySelector('.task-bulk-visibility select');check(visibility,'NS lacks bulk customer hiding');
  visibility.value='PROJECT_TEAM';visibility.dispatchEvent(new Event('change',{bubbles:true}));await tick();
  [...document.querySelectorAll('button')].find(b=>b.textContent.includes('일괄 적용')).click();await settle();
  check(writes.length===1&&writes[0][0].fields.visibility_code==='PROJECT_TEAM','NS bulk hide not saved');
  check(document.querySelector('.task-client-hidden-badge'),'hidden task marker missing');
  document.querySelector('.task-action-edit').click();await settle();
  const edit=document.querySelector('.task-edit-modal [name=visibility_code]');check(edit?.value==='PROJECT_TEAM','NS individual editor missing saved visibility');
  check(![...edit.options].some(o=>o.value==='POCKET_ONLY'),'NS private scope exposed');
  edit.value='CLIENT';edit.dispatchEvent(new Event('change',{bubbles:true}));await tick();
  document.querySelector('.task-edit-modal form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await settle();
  check(writes.length===2&&writes[1][0].fields.visibility_code==='CLIENT','NS individual public save failed');
  [...document.querySelectorAll('.task-workspace-tabs button')].find(b=>b.textContent==='간트').click();await settle();
  const ganttSelection=document.querySelector('.g-row input[type=checkbox]');if(!ganttSelection.checked)ganttSelection.click();await tick();
  check(document.querySelector('.task-bulk-visibility select'),'NS Gantt lacks customer visibility');
  await render(<div/>);let created;
  await render(<TaskCreateModal role="ns" clientName="QA" onClose={()=>{}} onSubmit={async(_,fields)=>{created=fields;}}/>);
  const create=document.querySelector('.task-create-dialog [name=visibility_code]');check(create&&create.getClientRects().length&&!create.closest('details'),'creation visibility hidden in advanced settings');
  check(create.options.length===2&&create.value==='PROJECT_TEAM','NS creation defaults/options incorrect');
  create.value='CLIENT';create.dispatchEvent(new Event('change',{bubbles:true}));await tick();
  document.querySelector('.task-create-dialog form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await settle();check(created?.visibility_code==='CLIENT','NS create did not submit visibility');
  await render(<div/>);await render(<DailyMeetingModal role="ns" onClose={()=>{}} onSave={async()=>{}}/>);await tick();
  check([...document.querySelectorAll('.daily-meeting-modal select option')].some(o=>o.value==='CLIENT'),'NS meeting sharing absent');
  check(![...document.querySelectorAll('.daily-meeting-modal select option')].some(o=>o.value==='POCKET_ONLY'),'NS meeting Pocket-only option exposed');
  await render(<div/>);await render(<TasksView role="client" canWrite={false} query="" taskPage={{items:[task],project:{id:'parity-client'}}}/>);await settle();
  check(!document.querySelector('.task-bulk-visibility,.task-action-edit,.schedule-start-date'),'client gained operational controls');
  return ['NS create/edit/table/Gantt customer hide/show, project date and meeting controls; customer and Pocket-only boundaries'];
}
