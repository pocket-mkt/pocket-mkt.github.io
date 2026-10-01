import React from 'react';
import ScheduleImportModal from '../src/ScheduleImportModal.jsx';
import { ProjectSidebar } from '../src/App.jsx';
import { TaskScheduleTimeline } from '../src/TaskWorkspace.jsx';
import { tasksViewModel } from '../src/api/viewModel.js';
import { runScheduleImportPlan } from '../src/scheduleImport.js';
import { taskMonthKey, shiftTaskMonth } from '../src/taskMonth.js';
import { scheduleFixture, scheduleHtml } from '../tests/fixtures/schedule-import.mjs';

export async function runScheduleImportQa(render,tick,check) {
  const projects=[{id:'other',clientName:'다른 QA',name:'QA 운영',permissionCode:'EDIT',allowedPages:['tasks']},{id:'schedule-qa',clientName:'일정 QA',name:'QA 운영',permissionCode:'EDIT',allowedPages:['tasks']}];
  let closes=0, opens=0, reads=0, failRead=false, failSecond=true;
  const ledger=new Map(),requests=[];
  const source={tasks:async({projectId})=>{reads++;if(failRead){failRead=false;throw Error('QA 목록 연결 실패');}return {data:{items:[...ledger.values()].filter(row=>row.project_id===projectId)}};}};
  const settle=async()=>{for(let i=0;i<5;i++)await tick();};
  const importPlan=async(plan,onProgress)=>runScheduleImportPlan(plan,async mutations=>{
    requests.push(mutations.map(item=>item.mutationId));await tick();
    for(const item of mutations)if(!ledger.has(item.mutationId))ledger.set(item.mutationId,{...item.fields,task_id:ledger.size+1,project_id:plan.projectId,row_version:1});
    // Server committed but the response was lost. Retrying must keep the same IDs.
    if(requests.length===2&&failSecond){failSecond=false;throw Error('QA 저장 응답 유실');}
  },onProgress);
  const modal=()=> <ScheduleImportModal currentProject={projects[0]} projects={projects} source={source} onImport={importPlan} onClose={()=>{closes++;}}/>;
  const upload=async(html,name='schedule.html')=>{
    const input=document.querySelector('input[type=file]'),transfer=new DataTransfer();transfer.items.add(new File([html],name,{type:'text/html'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));await settle();
  };
  const submit=()=>document.querySelector('.schedule-import-modal').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  const originalConfirm=window.confirm;
  try {
    await render(<div/>);await render(<ProjectSidebar project={projects[0]} role="pocket" activeView="tasks" open visible canCreateProject clients={[]} navigation={{actionLabel:'접기'}} onClose={()=>{}} onToggleNavigation={()=>{}} onCreateProject={()=>{}} onImportQuote={()=>{}} onImportSchedule={()=>{opens++;}}/>);
    const buttons=[...document.querySelectorAll('.sidebar-project-tools button')];
    check(buttons.map(button=>button.textContent).join('|')==='프로젝트 생성|견적서 불러오기|일정 불러오기','schedule import not directly below quote import');
    buttons[2].click();check(opens===1,'schedule import button inactive');
    await render(<ProjectSidebar project={projects[0]} role="client" activeView="tasks" open visible canCreateProject={false} clients={[]} navigation={{actionLabel:'접기'}} onClose={()=>{}} onToggleNavigation={()=>{}}/>);
    check(!document.body.textContent.includes('일정 불러오기'),'customer import control exposed');
    failRead=true;await render(modal());await settle();
    check(document.body.textContent.includes('QA 목록 연결 실패'),'existing read failure hidden');
    [...document.querySelectorAll('button')].find(button=>button.textContent==='다시 시도').click();await settle();check(reads>=2,'existing task retry failed');
    await upload('<html>unsupported</html>');check(document.querySelector('[role=alert]')&&requests.length===0,'invalid file wrote data');
    const data=scheduleFixture();await upload(scheduleHtml(data));
    check(!globalThis.scheduleHtmlExecuted&&!document.querySelector('img[src*=never-load]'),'uploaded HTML executed');
    check(document.querySelector('[aria-label="등록할 프로젝트"]').value==='schedule-qa','campaign did not match project');
    check(document.querySelector('input[type=month]').value==='2026-10','campaign month incorrect');
    check(document.querySelector('[aria-label="가져올 업무 공개 범위"]').value==='PROJECT_TEAM','internal work exposed by default');
    check(document.querySelectorAll('.schedule-import-table-wrap tbody tr').length===43,'preview count wrong');
    check(document.body.textContent.includes('일정 미정')&&document.body.textContent.includes('2026-09-30'),'undated/prior-month schedule lost');
    const owner=document.querySelector('[aria-label="QA 업무 1 담당"]');owner.value='POCKET';owner.dispatchEvent(new Event('change',{bubbles:true}));await tick();
    submit();submit();await settle();
    check(requests.length===2&&requests[0].length===40&&requests[1].length===3,'double submit or batch sizes wrong');
    check(document.body.textContent.includes('QA 저장 응답 유실')&&document.body.textContent.includes('40건 저장 확인'),'partial failure lost draft/progress');
    check(document.querySelector('[aria-label="등록할 프로젝트"]').disabled,'pending retry target editable');
    window.confirm=()=>false;document.querySelector('[aria-label="일정 불러오기 닫기"]').click();await tick();check(closes===0,'pending import discarded without confirmation');
    submit();await settle();check(closes===1&&ledger.size===43&&JSON.stringify(requests[1])===JSON.stringify(requests[2]),'retry duplicated or did not close');
    check([...ledger.values()][0].responsible_org_code==='POCKET','preview owner edit lost');
    await render(<div/>);await render(modal());await settle();await upload(scheduleHtml(data));
    check(document.body.textContent.includes('중복 43건 제외')&&document.querySelector('button[type=submit]').disabled,'reopening permits duplicate import');
    // A future import must be visible immediately, without persisting another user's filters.
    const next=shiftTaskMonth(taskMonthKey(new Date()),1),tasks=tasksViewModel({data:{items:[...ledger.values()].map(row=>({...row,execution_month:next+'-01'}))}}).items;
    await render(<div/>);await render(<TaskScheduleTimeline tasks={tasks} issues={[]} project={{...projects[1],scheduleFocus:{month:next,id:'import-complete'}}} query="" canWrite displayMode="gantt"/>);await settle();
    check(document.querySelector(`[data-execution-month="${next}"]`)?.getAttribute('aria-pressed')==='true','imported month not focused');
    check(document.querySelectorAll('.g-row[data-window-id]').length>0,'imported Gantt rows not rendered');
    // End on a compact preview for viewport screenshots. Fresh synthetic campaign, no writes.
    await render(<div/>);await render(modal());await settle();const preview=scheduleFixture(8);preview.campaigns[0].name='미리보기 QA';await upload(scheduleHtml(preview));
    const box=document.querySelector('.schedule-import-modal').getBoundingClientRect();
    check(box.width<=innerWidth&&box.left>=0&&box.bottom<=innerHeight+1,'import modal overflows viewport');
    check(document.documentElement.scrollWidth<=innerWidth+1,'import page horizontal overflow');
    return ['sidebar order, auto project/month, safe HTML, preview edits, 40+3 retry, double-submit guard, duplicate skip, future-month Gantt, responsive layout'];
  }finally{window.confirm=originalConfirm;}
}
