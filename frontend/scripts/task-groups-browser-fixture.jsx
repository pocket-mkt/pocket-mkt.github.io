import React, { useState } from 'react';
import { TaskScheduleTimeline } from '../src/TaskWorkspace.jsx';
import TaskUndoControl from '../src/TaskUndoControl.jsx';

export async function runTaskGroupsQa(render,tick,check) {
 const initial=[1,2,3].map(id=>({id:String(id),title:'그룹 업무 '+id,rowVersion:1,streamCode:'MARKETING',categoryCode:'NAVER',statusCode:'NOT_STARTED',scheduleDates:['2026-09-19','2026-09-21'],plannedStartDate:'2026-09-19',dueDate:'2026-09-21'}));
 const project={id:'groups',clientName:'QA',startDate:'2026-09-01',endDate:'2026-09-30'};
 let writes=[];
 function Fixture({mode}) {
   const [tasks,setTasks]=useState(initial);
   return <TaskScheduleTimeline tasks={tasks} project={project} issues={[]} query="" canWrite displayMode={mode} onBatchUpdate={async updates=>{
     writes.push(updates);setTasks(current=>current.map(task=>{const change=updates.find(item=>item.task.id===task.id);return change?{...task,taskGroupId:change.fields.task_group_id,taskGroupName:change.fields.task_group_name,rowVersion:task.rowVersion+1}:task;}));
   }} />;
 }
 const button=text=>[...document.querySelectorAll('button')].find(item=>item.textContent===text);
 for(const mode of ['table','gantt']) {
   await render(<div/>);await render(<Fixture mode={mode}/>);
   document.querySelector('[aria-label="표시된 업무 전체 선택"]').click();await tick();button('업무 그룹').click();await tick();
   check(document.querySelector('[role="dialog"]'),'group name dialog missing');
   const input=document.querySelector('.task-group-dialog input');
   Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'외부유입 실행작업');input.dispatchEvent(new Event('input',{bubbles:true}));await tick();
   document.querySelector('form.task-group-dialog').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await tick();await tick();
   check(writes.at(-1).length===3,'group selected count');
   check(document.querySelectorAll('.task-custom-group-label').length===1,'group header missing');
   check(!document.querySelector('.task-schedule-row,.g-row[data-task-id]'),'group should initially collapse');
   if(mode==='gantt') check(document.querySelectorAll('.g-custom-summary').length===2,'group filled schedule gap');
   document.querySelector('.task-custom-group-label button').click();await tick();
   check(document.querySelector('.task-custom-group-label button').getAttribute('aria-expanded')==='true','expand failed');
   document.querySelector('.task-custom-group-label input').click();await tick();
   check(document.querySelector('.task-bulk-toolbar strong').textContent==='3개 선택','group checkbox selection');
   button('그룹 해제').click();await tick();await tick();
   check(!document.querySelector('.task-custom-group-label'),'ungroup failed');
   check(writes.at(-1).every(item=>item.fields.task_group_id===null),'ungroup payload');
 }
 let undoCount=0;
 await render(<><TaskUndoControl entry={{ids:['one']}} busy={false} onUndo={()=>undoCount++}/><input aria-label="text-undo"/></>);
 document.querySelector('.task-undo-button').click();await tick();
 const input=document.querySelector('input');input.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}));await tick();
 check(undoCount===1,'text input undo stolen');
 document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}));await tick();
 check(undoCount===2,'Ctrl Z not wired');
 return {table:true,gantt:true,sparseSummary:true,nameDialog:true,ungroup:true,undo:true,textUndoPreserved:true};
}
