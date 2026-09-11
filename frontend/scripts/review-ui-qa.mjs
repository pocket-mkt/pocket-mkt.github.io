// Isolated browser regression: no real login, DB writes, or user's browser profile.
import { build } from "esbuild";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";

const bundle = await build({
  stdin: { contents: `
import React, { lazy, Suspense, useState } from 'react';
import BlogStatusView from './src/BlogStatusView.jsx';
import MeetingText from './src/MeetingText.jsx';
import { createRoot } from 'react-dom/client';
import { CredentialLedgerView } from './src/CredentialLedgerView.jsx';
import { useOverviewResource } from './src/useOverviewResource.js';
import { ProjectClientProgressView, Topbar, ProjectSidebar } from './src/App.jsx';
import { LoginScreen } from './src/App.jsx';
import { ProjectIssuePanel, TaskScheduleTimeline, TaskEditModal } from './src/TaskWorkspace.jsx';
import PermissionsView from './src/PermissionsView.jsx';
import IssueRequestCard from './src/IssueRequestCard.jsx';
import DetailLogView from './src/DetailLogView.jsx';
import ScreenBoundary from './src/ScreenBoundary.jsx';
import WorkspaceNotifications from './src/WorkspaceNotifications.jsx';
import NotificationIssueDialog from './src/NotificationIssueDialog.jsx';
import { OperationsDashboardView } from './src/OperationsDashboardView.jsx';
import { ProgressView } from './src/ProgressView.jsx';
import { TaskColumn } from './src/ProgressFlow.jsx';
import InternalPreviewTaskEditor from './src/InternalPreviewTaskEditor.jsx';
import DeadlineTaskLink from './src/DeadlineTaskLink.jsx';
import TaskInlineSelect from './src/TaskInlineSelect.jsx';
import { TaskCreateModal } from './src/TaskCreateModal.jsx';
import { tasksViewModel } from './src/api/viewModel.js';
import './src/styles.css';
import './src/sidebarWorkspace.css';
const QuoteImportModal = lazy(() => import('./src/QuoteImportModal.jsx'));
const root = createRoot(document.getElementById('root'));
const tick = () => new Promise(resolve => setTimeout(resolve, 40));
const check = (ok, message) => { if (!ok) throw Error(message); };
const deferred = () => { let resolve; const promise = new Promise(done => resolve = done); return {promise, resolve}; };
const render = async element => { root.render(element); await tick(); };
const bootstrapState = {status:'ready',data:{projects:{A:{id:'A',allowedPages:['overview']}, B:{id:'B',allowedPages:['overview']}}}};
let overviewState;
const overviewCalls = [];
const source = {overview: params => { const pending=deferred(); overviewCalls.push({...params,...pending}); return pending.promise; }};
window.runBlogQa = async () => {
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 let items=[{id:'a',project_id:1,platform:'NAVER',title:'QA 게시글 제목',url:'https://example.com/post',keyword:'목표 키워드',published_on:today,monthly_volume:null,goal_rank:5,row_version:1}],history=[];
 let writes=0;const source={blog:async({platform})=>({data:{items:items.filter(x=>x.platform===platform),history,hasMore:false}}),saveBlog:async({item,fields})=>{writes++;const next={...item,...fields,row_version:2};items=item?items.map(x=>x.id===item.id?next:x):[...items,next];return {data:next};},saveBlogRank:async({targetId,fields})=>{writes++;const next={id:'r',target_id:targetId,...fields,rank:Number(fields.rank),row_version:1};history=[next];return {data:next};}};
 await render(<BlogStatusView project={{id:1,clientName:'QA'}} source={source} canWrite/>);await tick();
 check(document.querySelector('.blog-title')?.textContent.includes('QA 게시글'),'blog load');
 check(document.documentElement.scrollWidth<=innerWidth+1,'blog viewport overflow');
 check(document.querySelector('.blog-title').getBoundingClientRect().height<=48,'blog compact row');
 document.querySelectorAll('.blog-platform button')[1].click();await tick();await tick();check(document.querySelector('.blog-empty'),'google empty rather than fake data');
 document.querySelectorAll('.blog-platform button')[0].click();await tick();await tick();
 const postLink=document.querySelector('.blog-title a');check(postLink?.href==='https://example.com/post'&&postLink.target==='_blank'&&postLink.rel.includes('noopener'),'blog title direct safe link');
 document.querySelector('.blog-rank-open').click();await tick();check(document.querySelector('[role="dialog"]'),'blog detail dialog');
 const rank=document.querySelector('[role="dialog"] input[type=number]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(rank,'3');rank.dispatchEvent(new Event('input',{bubbles:true}));await tick();
 document.querySelector('[role="dialog"] form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await tick();check(writes===1,'manual rank save');check(document.querySelector('.blog-history').textContent.includes('3위'),'saved rank visible');
 document.querySelector('[aria-label="닫기"]').click();await tick();
 document.querySelector('.blog-heading button').click();await tick();check(document.querySelector('[name="keyword"]'),'blog create form');document.querySelector('[aria-label="닫기"]').click();await tick();
 await render(<div/>);await render(<BlogStatusView project={{id:1,clientName:'QA'}} source={source} canWrite/>);await tick();check(document.querySelector('tbody').textContent.includes('3위'),'rank reload');
 return ['blog desktop/mobile: automatic read, platform isolation, compact rows, modal, manual rank save and reload'];
};
window.runMeetingEmphasisQa = async () => {
 await render(<div className="ops-meeting-body" style={{padding:20,maxWidth:720}}><section><h3>회의 핵심 표시</h3><ul>{['[중요] 이번 회의에서 확정한 최우선 목표와 마감 사항','포켓: 자료와 실행 기준을 확인하고 전달','NS: 집행 상태와 다음 작업 일정 확인','NS·포켓: 공동으로 검토할 측정 기준','일반 회의 내용은 기본 글자색 유지','<script>실행하지 않는 텍스트</script>'].map((line,i)=><li key={i}><MeetingText>{line}</MeetingText></li>)}</ul></section></div>);
 const colors=['important','pocket','ns'].map(tone=>getComputedStyle(document.querySelector('.meeting-text-line.is-'+tone)).color);
 check(colors.join('|')==='rgb(180, 35, 50)|rgb(29, 78, 216)|rgb(126, 34, 168)','meeting emphasis colors');
 check(document.querySelectorAll('.meeting-label.is-pocket').length===2&&document.querySelectorAll('.meeting-label.is-ns').length===2,'joint responsibility labels');
 check(!document.querySelector('.ops-meeting-body script'),'meeting markup remains escaped text');
 check(document.documentElement.scrollWidth<=innerWidth+1,'meeting mobile overflow');
 return ['meeting colors, joint ownership, escaped text, responsive layout'];
};
window.benchmarkQa = async () => {
 const results=[];



 for(const count of [100,500,1000]) for(const mode of ['table','gantt']) {
  await render(<div/>);
  const tasks=tasksViewModel({data:{items:Array.from({length:count},(_,i)=>({task_id:i+1,project_id:1,title:'QA 업무 '+(i+1),category_code:'YOUTUBE',workstream_code:'MARKETING',status_mode:'MANUAL',status_code:'IN_PROGRESS',progress_percent:30,planned_start_date:'2026-09-01',due_date:'2026-09-30',schedule_dates_json:'["2026-09-01"]',visibility_code:'CLIENT'})),totalMatching:count}}).items;
  const started=performance.now();
  await render(<TaskScheduleTimeline tasks={tasks} issues={[]} project={{id:1,clientName:'QA',name:'QA'}} query="" canWrite={true} onUpdate={async()=>{}} onBatchUpdate={async()=>{}} displayMode={mode} onViewChange={()=>{}}/>);
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  results.push({count,mode,mountAndPaintMs:Math.round(performance.now()-started),domNodes:document.querySelectorAll('*').length});
 }
 return results;
};
window.runLargeListQa = async () => {
 const tasks=tasksViewModel({data:{items:Array.from({length:500},(_,i)=>({task_id:i+1,project_id:1,title:'QA 업무 '+(i+1),description:'여러 줄로 표시하는 업무 설명',category_code:'YOUTUBE',workstream_code:'MARKETING',status_mode:'MANUAL',status_code:'IN_PROGRESS',progress_percent:30,planned_start_date:'2026-09-01',due_date:'2026-09-30',visibility_code:'CLIENT'})),totalMatching:500}}).items;
 for(const mode of ['table','gantt']) {
  const writes=[];
  await render(<div/>);
  await render(<TaskScheduleTimeline tasks={tasks} issues={[]} project={{id:1,clientName:'QA',name:'QA'}} query="" canWrite={true} onUpdate={async()=>{}} onBatchUpdate={async updates=>{writes.push(updates);}} displayMode={mode} onViewChange={()=>{}}/>);
  const scroll=document.querySelector(mode==='table'?'.reference-task-scroll':'.reference-gantt-scroll');
  check(scroll.querySelectorAll('[data-window-id]').length<80,'large list renders every row');
  if(mode==='table') {
   const boxes=[...scroll.querySelectorAll('tbody .reference-task-select input')];
   boxes[0].click();await tick();boxes[4].dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}));await tick();
   check(document.querySelector('.task-bulk-toolbar')?.textContent.includes('5개 선택'),'Shift range selection broke: '+document.querySelector('.task-bulk-toolbar')?.textContent);
   const input=scroll.querySelector('tbody textarea');const row=input.closest('[data-window-id]');const id=row.dataset.windowId;
   input.focus();await tick();scroll.scrollTop=2000;scroll.dispatchEvent(new Event('scroll'));await tick();
   check(document.activeElement===input && scroll.querySelector('[data-window-id="'+id+'"]'),'scroll unmounted focused editor');
   input.blur();await tick();
  }
  scroll.scrollTop=scroll.scrollHeight;scroll.dispatchEvent(new Event('scroll'));await tick();await tick();
  check([...scroll.querySelectorAll('[data-window-id]')].some(row=>row.dataset.windowId===String(tasks.at(-1).id)),'cannot reach final task by scrolling '+mode);
  scroll.scrollTop=0;scroll.dispatchEvent(new Event('scroll'));await tick();await tick();
  check(scroll.querySelectorAll('[data-window-id]').length<80,'rows did not release after returning to top');
  if(mode==='gantt') {
   const cell=scroll.querySelector('.g-c[data-gantt-task-id]');
   cell.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1}));
   window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,pointerId:1}));
   window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,pointerId:1}));await tick();
   check(writes.length===1 && writes[0].length===1,'Gantt gesture did not produce exactly one task mutation');
  }
 }
 return ['500-row table/Gantt: bounded DOM, scroll to final row and back, Shift selection, focused editor retained, one mutation per Gantt gesture'];
};
function Overview({projectId}) {
 const [state,setState]=useState({status:'idle'});
 const [session,setSession]=useState(null);
 overviewState=state;
 useOverviewResource({source,activeProjectId:projectId,view:'overview',bootstrapState,actorRole:'client',overviewState:state,pageRefreshKey:0,setOverviewState:setState,setSession});
 return <div>{state.projectId}:{state.status}</div>;
}
window.showIssueQa = async () => {
 await render(<div style={{maxWidth:720,margin:'20px auto',padding:12}}><IssueRequestCard issue={{id:1,kind:'컨펌요청',owner:'허준',requester:'NS마케팅',createdAt:'2026-09-08T05:37:00Z',date:'2026-09-08',relatedTask:'블로그',body:'블로그 원고 컨펌 요청 (이미지 AI 제작)\\n원고 내용과 이미지 방향을 확인한 뒤 답변 부탁드립니다.',statusCode:'IN_PROGRESS',completionUrl:'https://example.com/result'}} canWrite actorName="QA" onUpdate={async(issue,fields)=>({...issue,...fields})} onArchive={async()=>{}}/></div>);
 const card=document.querySelector('.issue-request-card');
 check(parseFloat(getComputedStyle(card.querySelector('h3')).fontSize)>=18,'request title too small');
 check(parseFloat(getComputedStyle(card.querySelector(':scope>p')).fontSize)>=15,'request body too small');
 check(document.documentElement.scrollWidth<=window.innerWidth+1,'request card overflows viewport');
};
function IssueTabsQa() {
 const [issues,setIssues]=useState([{id:1,relatedTask:'대기 요청',body:'확인해주세요',statusCode:'IN_PROGRESS',createdAt:'2026-09-08T03:00:00Z'},{id:2,relatedTask:'기존 완료',statusCode:'DONE',createdAt:'2026-09-07T03:00:00Z'}]);
 return <ProjectIssuePanel issues={issues} project={{id:'QA',clientName:'QA'}} canWrite actorName="QA" onUpdate={async(issue,fields)=>{const next={...issue,statusCode:fields.status_code||issue.statusCode};setIssues(items=>items.map(item=>item.id===issue.id?next:item));return next;}} onArchive={async(issue)=>setIssues(items=>items.filter(item=>item.id!==issue.id))} onCreate={async()=>{}}/>;
}
window.runLocalSortQa = async () => {
 const tasks=tasksViewModel({data:{items:['IN_PROGRESS','DONE','DONE','DELAYED'].map((status,i)=>({task_id:i+1,project_id:1,title:'정렬 검증 '+i,category_code:i%2?'YOUTUBE':'INSTAGRAM',workstream_code:'DESIGN',responsible_org_code:i<2?'POCKET':'NS',status_mode:'MANUAL',status_code:status,planned_start_date:'2026-09-01',due_date:'2026-09-30',visibility_code:'CLIENT'}))}}).items;
 let writes=0;
 const view=id=><TaskScheduleTimeline tasks={tasks} issues={[]} project={{id,clientName:'QA',name:'QA'}} query="" canWrite onUpdate={async()=>{writes++;}} onBatchUpdate={async()=>{writes++;}} displayMode="table" onViewChange={()=>{}}/>;
 await render(<div/>);await render(view(1));
 const order=()=>[...document.querySelectorAll('.reference-task-row')].map(row=>row.dataset.windowId);
 const initial=order();
 const click=async field=>{document.querySelector('[data-sort-field="'+field+'"]').click();await tick();};
 await click('status');check(order().slice(0,2).every(id=>['2','3'].includes(id)),'completed across media first');
 await click('owner');check(order()[0]==='3','latest owner primary, status secondary');
 check(!document.querySelector('.task-reorder-handle').draggable,'sorted drag must not persist order');
 await click('status');check(order()[0]==='1','latest status primary');
 await click('status');check(order()[0]==='4','delayed first');
 await click('status');await click('owner');await click('owner');
 check(JSON.stringify(order())===JSON.stringify(initial),'default restores original media/authored order');
 check(document.querySelector('.task-reorder-handle').draggable,'default drag restored');
 await click('status');await render(view(2));check(!document.querySelector('.task-local-sort.is-active'),'project resets local sort');
 await click('status');await render(<div/>);await render(view(2));check(!document.querySelector('.task-local-sort.is-active'),'fresh mount resets local sort');
 check(writes===0,'sorting made persistence calls');
 await click('status');await click('owner');
 return ['cross-media stable sorting, cycles, latest priority, zero writes, project/remount reset, drag safety'];
};
window.runChecklistQa = async () => {
 const tasks=tasksViewModel({data:{items:['NOT_STARTED','IN_PROGRESS','DELAYED','DONE','ON_HOLD'].map((status,i)=>({task_id:i+1,project_id:1,title:'완료 체크 검증 업무 '+i,category_code:'INSTAGRAM',workstream_code:'DESIGN',responsible_org_code:'NS',status_mode:'MANUAL',status_code:status,progress_percent:45,planned_start_date:'2026-09-01',due_date:'2026-09-30',visibility_code:'CLIENT'}))}}).items;
 const writes=[];
 for(const mode of ['table','gantt']) {
  await render(<div/>);
  await render(<TaskScheduleTimeline tasks={tasks} issues={[]} project={{id:1,clientName:'QA',name:'QA'}} query="" canWrite onUpdate={async(task,fields)=>{writes.push(fields);}} onBatchUpdate={async()=>{}} displayMode={mode} onViewChange={()=>{}}/>);
  const boxes=[...document.querySelectorAll('.task-done-check')];check(boxes.length===5,mode+' completion check count');check(boxes.filter(x=>x.checked).length===1,mode+' status rather than percentage');
  check(!document.querySelector('input[name="progress_percent"]'),mode+' legacy percent input');
  if(mode==='table') {
   boxes[0].click();await tick();check(writes.at(-1)?.status_code==='DONE','completion saves canonical status');
   boxes[3].click();await tick();check(writes.at(-1)?.status_code==='IN_PROGRESS','uncheck reopens');
   const button=document.querySelector('.reference-task-status .task-choice-trigger');button.scrollIntoView({block:'center',inline:'center'});await tick();button.click();await tick();
   check([...document.querySelectorAll('[role="menuitemradio"]')].map(x=>x.firstElementChild.textContent).join('|')==='시작 전|진행중|지연|완료|보류','five ordered status choices');
  }
 }
 return ['table/Gantt completion indicators, canonical check/uncheck writes, five ordered statuses, no percentage input'];
};
window.showChoiceQa = async () => {
 const tasks=tasksViewModel({data:{items:Array.from({length:4},(_,i)=>({task_id:i+1,project_id:1,title:'콘텐츠 제작 / 업로드 '+(i+1),description:'카드뉴스 기획 및 디자인 제작',category_code:'INSTAGRAM',workstream_code:'DESIGN',responsible_org_code:'NS',status_mode:'MANUAL',status_code:'IN_PROGRESS',progress_percent:30,planned_start_date:'2026-09-01',due_date:'2026-09-30',visibility_code:'CLIENT'}))}}).items;
 await render(<TaskScheduleTimeline tasks={tasks} issues={[]} project={{id:1,clientName:'UND',name:'QA'}} query="" canWrite={true} onUpdate={async()=>{}} onBatchUpdate={async()=>{}} displayMode="table" onViewChange={()=>{}}/>);
 const choice=document.querySelector('.reference-task-owner .task-choice-trigger');choice.scrollIntoView({block:'center',inline:'center'});await tick();choice.click();await tick();
 check(getComputedStyle(document.querySelector('.reference-task-status .task-choice-trigger')).fontSize==='12px','actual status font overridden');
 check(document.querySelector('.task-choice-menu'),'actual table owner menu missing');
};
window.showRequestBodyQa = async () => {
 const dashboard={range:{from:'2026-09-07',to:'2026-09-11'},projects:[{id:'1',name:'통합 마케팅 운영',clientName:'UND',totalTasks:0,inProgressTasks:0,onHoldTasks:0,overdueTasks:0,doneTasks:0}],meetings:[],weeklyTasks:[],issues:[
  {id:'body-open',projectId:'1',clientName:'UND',projectName:'통합 마케팅 운영',relatedTask:'블로그',body:'블로그 원고 검토 요청드립니다.\\n이미지 제작 방향과 수정이 필요한 부분을 확인해 주세요.',requester:'NS마케팅',createdAt:'2026-09-08T05:37:00Z',date:'2026-09-08',statusCode:'IN_PROGRESS'},
  {id:'body-done',projectId:'1',clientName:'UND',projectName:'통합 마케팅 운영',relatedTask:'인스타그램',body:'카드뉴스 시안 확인 및 문구 수정 완료',requester:'포켓',createdAt:'2026-09-07T05:37:00Z',date:'2026-09-07',statusCode:'DONE'}]};
 await render(<div/>);
 await render(<OperationsDashboardView dashboard={dashboard} canWrite={false} onOpenProject={()=>{}}/>);
};
window.runQa = async () => {
 const results=[];
 let channelPayload;
 await render(<TaskCreateModal role="ns" clientName="QA" tasks={[{categoryCode:'CUSTOM',category:'맞춤 채널'}, {categoryCode:'GOOGLE_SEARCH'}]} todayValue="2026-09-09" onClose={()=>{}} onSubmit={async(type,fields)=>{channelPayload=fields;}}/>);
 const channelSelect=document.querySelector('select[name="category_code"]');
 check(channelSelect && [...channelSelect.options].some(option=>option.value==='CUSTOM'), 'creation includes project channels');
 check(channelSelect.options.length===9 && ['NAVER','NAVER_BLOG','INSTAGRAM','YOUTUBE','TIKTOK','ADS'].every(code=>[...channelSelect.options].some(option=>option.value===code)), 'shared registered media plus unknown project media');
 channelSelect.value='GOOGLE_SEARCH';
 channelSelect.dispatchEvent(new Event('change',{bubbles:true}));
 await tick();
 document.querySelector('.task-create-submit').click();
 await tick();
 check(channelPayload?.category_code==='GOOGLE_SEARCH', 'creation submits selected channel');
 check(channelSelect.getBoundingClientRect().width>200, 'channel dropdown remains usable on mobile');
 results.push('task channel dropdown saves canonical category without extra fetch');
 await render(<div/>);
 let mediaUpdate;
 const mediaTask={id:71,title:'매체 수정 QA',categoryCode:'INSTAGRAM',statusCode:'NOT_STARTED'};
 await render(<TaskEditModal task={mediaTask} tasks={[mediaTask,{categoryCode:'NAVER_BLOG'}]} clientName="QA" onClose={()=>{}} onUpdate={async(task,fields)=>{mediaUpdate=fields;}}/>);
 const mediaSelect=document.querySelector('.task-edit-modal select[name="category_code"]');
 check(mediaSelect?.value==='INSTAGRAM' && mediaSelect.options.length===7, 'edit preserves saved media and offers shared registered media');
 mediaSelect.value='NAVER_BLOG'; mediaSelect.dispatchEvent(new Event('change',{bubbles:true})); await tick();
 document.querySelector('.task-edit-modal button[type="submit"]').click(); await tick();
 check(mediaUpdate?.category_code==='NAVER_BLOG', 'edit saves selected media through canonical mutation');
 results.push('task edit: saved media preselected, shared registered list, canonical category update');
 await render(<div/>);
 await render(<LoginScreen configured loading={false} onLogin={async()=>{}}/>);
 const loginLogo=document.querySelector('.login-mark img');
 for(let attempt=0;attempt<20&&!loginLogo.complete;attempt++)await tick();
 check(loginLogo.naturalWidth>0 && loginLogo.alt==='포켓컴퍼니','login brand asset missing');
 check(!document.querySelector('.login-mark svg') && getComputedStyle(document.querySelector('.login-mark .sidebar-company-symbol')).width==='40px','login symbol size/lock replacement');
 check(document.querySelector('input[type="password"]') && document.querySelector('.login-submit').disabled,'login form behavior changed');
 results.push('Login: original Pocket symbol loaded at 40px, lock removed, form preserved');
 let issueAlertSelection=null;
 const issueAlert={id:8765,entity_type:'PROJECT_ISSUE',entity_id:55,project_id:7,actor_user_id:'actor-qa',created_at:new Date().toISOString(),project:{project_name:'UND'}};
 const issueAlertSource={activity:async()=>({data:{items:[issueAlert],actors:[{id:'actor-qa',display_name:'QA 작성자'}],nextCursor:null}})};
 await render(<WorkspaceNotifications source={issueAlertSource} actorId="issue-qa" issues={[{id:55,projectId:'7',relatedTask:'원고 검토',body:'새 원고 확인 부탁드립니다.'}]} onSelect={item=>issueAlertSelection=item}/>);
 document.querySelector('.notification-trigger').click();await tick();
 check(document.querySelector('.notification-list').textContent.includes('확인요청 · 원고 검토') && document.querySelector('.notification-list').textContent.includes('QA 작성자'),'issue notification content missing');
 document.querySelector('.notification-item').click();await tick();
 check(issueAlertSelection.entityType==='PROJECT_ISSUE' && issueAlertSelection.projectId==='7','issue notification routing');
 const issueDialogReads=[];
 const issueDialogSource={tasks:async params=>{issueDialogReads.push(params);return {data:{issues:[{issue_id:55,related_task_text:'원고 검토',body_text:'새 원고 확인 부탁드립니다.',status_code:'IN_PROGRESS',row_version:9}],items:[]}};}};
 await render(<NotificationIssueDialog request={issueAlertSelection} source={issueDialogSource} canWrite actorName="QA" onUpdate={async()=>{}} onClose={()=>{}}/>);
 for(let attempt=0;attempt<50&&!document.querySelector('[aria-label="확인 요청 상세"]');attempt++)await tick();
 check(issueDialogReads[0].projectId==='7' && document.querySelector('[aria-label="확인 요청 상세"]').textContent.includes('새 원고 확인 부탁드립니다.'),'issue notification must load selected project and open reply dialog');
 check(document.querySelector('[aria-label="확인 요청 상세"]').textContent.includes('답변'),'issue alert reply action missing');
 await render(<NotificationIssueDialog request={{...issueAlertSelection,id:99}} source={issueDialogSource} canWrite onClose={()=>{}}/>);await tick();
 check(document.querySelector('[aria-label="확인요청 불러오기"]').textContent.includes('삭제 여부'),'unavailable issue must show recoverable error');
 results.push('Issue notifications: created issue, author/body labels, project-safe detail dialog and missing request error');
 await window.showRequestBodyQa();
 const requestBody=document.querySelector('.ops-issue-body');
 check(requestBody.textContent.includes('이미지 제작 방향'),'request body absent from list');
 check(getComputedStyle(requestBody).fontSize==='13px' && getComputedStyle(requestBody).fontWeight==='400','request body typography');
 check(document.querySelector('.ops-issue-company').textContent==='UND','company label must omit campaign/project name');
 check(document.querySelectorAll('.ops-issue-byline').length===2,'author and created date must be separate rows');
 check(getComputedStyle(requestBody).fontFamily===getComputedStyle(document.querySelector('.ops-issue-title')).fontFamily,'request typography must share one font family');
 check(requestBody.scrollWidth<=requestBody.clientWidth+1,'request body overflows');
 requestBody.click();await tick();check(document.querySelector('[aria-label="확인 요청 상세"]'),'request body click must open existing dialog');
 document.querySelector('[aria-label="확인 요청 상세"] [aria-label="닫기"]').click();await tick();
 document.querySelectorAll('.ops-issue-tabs button')[1].click();await tick();
 check(document.querySelector('.ops-issue-body').textContent.includes('문구 수정 완료'),'completed request body absent');
 results.push('Integrated requests: company-only label, separate author/date, unified 13px normal-weight body, wrapping and dialog');
 let choiceWrites=[];
 await render(<div className="campaign-schedule-surface"><TaskInlineSelect aria-label="업무 상태" value="TODO" onChange={event=>choiceWrites.push(event.target.value)}><option value="TODO">미착수</option><option value="DONE">완료</option></TaskInlineSelect></div>);
 const choiceTrigger=document.querySelector('.task-choice-trigger');choiceTrigger.click();await tick();
 check(document.querySelector('.task-choice-menu')?.parentElement===document.body,'choice popup clipped by table');
 check(getComputedStyle(document.querySelector('[role="menuitemradio"]')).textAlign==='center','choice option alignment');
 check(getComputedStyle(choiceTrigger).fontSize==='12px','choice trigger typography');
 document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
 check(document.activeElement.textContent==='완료','choice arrow navigation');document.activeElement.click();await tick();
 check(choiceWrites.join()==='DONE' && !document.querySelector('.task-choice-menu'),'choice did not save once/close');
 choiceTrigger.click();await tick();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await tick();
 check(!document.querySelector('.task-choice-menu') && document.activeElement===choiceTrigger,'choice Escape focus return');
 choiceTrigger.click();await tick();document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));await tick();
 check(!document.querySelector('.task-choice-menu'),'choice outside dismissal');
 await render(<TaskInlineSelect disabled value="NS" onChange={()=>choiceWrites.push('forbidden')}><option value="NS">NS</option></TaskInlineSelect>);
 document.querySelector('.task-choice-trigger').click();await tick();check(!document.querySelector('.task-choice-menu') && choiceWrites.length===1,'disabled choice mutated');
 results.push('Schedule popup: centered typography, portal, keyboard, single save, Escape/outside and disabled permissions');
 let linkReads=0;
 await render(<DeadlineTaskLink task={{id:'1',projectId:'7'}} onResolve={async()=>{linkReads++;return 'https://example.com/completed';}}/>);
 check(!document.querySelector('.ops-completion-load'),'manual lookup button must not exist');
 await tick();
 check(linkReads===1&&document.querySelector('.ops-completion-link').href==='https://example.com/completed','completion link not resolved');
 check(document.querySelector('.ops-completion-link').rel.includes('noopener'),'completion link missing opener protection');
 check(document.querySelector('.ops-completion-link').textContent==='열기 ↗' && document.querySelector('.ops-completion-url').textContent==='https://example.com/completed','inline saved URL missing');
 await render(<DeadlineTaskLink task={{id:'2',completionUrl:''}}/>);check(document.querySelector('.ops-completion-empty').textContent==='—','empty link state missing');
 await render(<DeadlineTaskLink task={{id:'3',completionUrl:'javascript:alert(1)'}}/>);check(!document.querySelector('a'),'unsafe completion URL allowed');
 const lateLink=deferred();
 await render(<DeadlineTaskLink task={{id:'old',projectId:'7'}} onResolve={()=>lateLink.promise}/>);
 await render(<DeadlineTaskLink task={{id:'new',completionUrl:'https://example.com/new'}}/>);
 lateLink.resolve('https://example.com/old');await tick();
 check(document.querySelector('.ops-completion-link').href==='https://example.com/new','late link response replaced current task');
 results.push('deadline completion links: automatic load, inline saved URL, safe link, empty/unsafe and stale response checks');
 const previewTask={id:'91',title:'미리보기 업무',statusCode:'IN_PROGRESS',description:'공개 내용'};const previewCalls=[];const previewWrites=[];
 const previewSource={tasks:async params=>{previewCalls.push(params);return {data:{items:[{task_id:91,title:'미리보기 업무',project_id:1,status_code:'IN_PROGRESS',progress_percent:40,responsible_org_code:'NS',remarks:'내부 원본 비고',row_version:7}]}};}};
 const previewPage=<ProjectClientProgressView project={{id:'1',name:'QA',clientName:'QA'}} taskPage={{items:[previewTask]}}/>;
 await render(<InternalPreviewTaskEditor project={{id:'1',clientName:'QA'}} role="pocket" canWrite source={previewSource} onUpdate={async(task,fields)=>previewWrites.push({task,fields})}>{previewPage}</InternalPreviewTaskEditor>);
 for(let attempt=0;attempt<50&&!document.querySelector('.pb-flow-summary');attempt++)await tick();
 document.querySelector('.pb-flow-summary').click();
 for(let attempt=0;attempt<50&&!document.querySelector('.task-edit-modal');attempt++)await tick();
 check(previewCalls.length===1&&document.querySelector('.task-edit-modal'),'internal customer-preview row must fetch canonical task and open modal');
 document.querySelector('.task-edit-modal form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await tick();
 check(previewWrites.length===1&&previewWrites[0].fields.remarks==='내부 원본 비고'&&previewWrites[0].fields.responsible_org_code==='NS','public projection must not erase canonical private fields');
 await render(<InternalPreviewTaskEditor project={{id:'1'}} role="client" canWrite source={previewSource} onUpdate={()=>{throw Error('customer write');}}>{previewPage}</InternalPreviewTaskEditor>);
 document.querySelector('.pb-flow-summary').click();await tick();
 check(previewCalls.length===1&&!document.querySelector('.task-edit-modal'),'customer must never fetch internal tasks or edit');
 results.push('client-preview real page: internal editor uses canonical fields; customer cannot fetch/edit');
 const flowWrites=[];
 const flowTask={id:'flow-1',title:'흐름 수정 QA',statusCode:'IN_PROGRESS',progressPercent:30,description:'수정 전',priorityCode:'NORMAL',responsibleOrgCode:'POCKET',plannedStartDate:'2026-09-01',dueDate:'2026-09-30'};
 await render(<ProgressView project={{id:'1',name:'QA',clientName:'QA'}} role="pocket" canWrite taskPage={{items:[flowTask],issues:[]}} source={{dailyMeetings:async()=>({data:{items:[]}})}} onTaskUpdate={async(task,fields)=>flowWrites.push({task,fields})} onNavigate={()=>{}}/>);
 document.querySelector('.pb-flow-summary').click();
 for(let attempt=0;attempt<50&&!document.querySelector('.task-edit-modal');attempt++)await tick();
 check(document.querySelector('.task-edit-modal input')?.value==='흐름 수정 QA','flow click did not open task editor');
 document.querySelector('.task-edit-modal form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await tick();
 check(flowWrites.length===1&&flowWrites[0].task.id==='flow-1'&&!document.querySelector('.task-edit-modal'),'flow save must use canonical task callback and close');
 await render(<TaskColumn title="QA" items={[flowTask]} client onEdit={()=>{throw Error('client editing allowed');}}/>);
 document.querySelector('.pb-flow-summary').click();await tick();check(document.querySelector('details').open&&!document.querySelector('.task-edit-modal'),'client flow must stay read-only');
 results.push('flow task edit: existing modal, one canonical save, client read-only disclosure');
 const qaMonday=new Date();qaMonday.setDate(qaMonday.getDate()-((qaMonday.getDay()+6)%7));const qaDue=qaMonday.getFullYear()+'-'+String(qaMonday.getMonth()+1).padStart(2,'0')+'-'+String(qaMonday.getDate()).padStart(2,'0');
 const deltaDashboard={range:{from:qaDue,to:qaDue},projects:[{id:'1',name:'QA',clientName:'QA',totalTasks:1}],meetings:[],issues:[],weeklyTasks:[{id:'1',projectId:'1',title:'QA 상승 업무',dueDate:qaDue,statusCode:'IN_PROGRESS',progressPercent:60,progressDeltaToday:30}]};
 await render(<OperationsDashboardView dashboard={deltaDashboard} canWrite={false} onOpenProject={()=>{}} onLoadWeek={async()=>deltaDashboard}/>);
 check(!document.querySelector('.ops-progress-delta')&&!document.querySelector('.ops-progress'),'percentage removed from portfolio');
 check(document.querySelector('.ops-task-completion')?.textContent==='미완료','unfinished task incorrectly completed');
 results.push('completion checklist: no percent or delta, actual status completion shown');
 let notificationSelection=null;const notificationCalls=[];
 const notificationSource={activity:async params=>{notificationCalls.push(params);return {data:{items:[{id:9001,entity_id:11,project_id:1,created_at:new Date().toISOString(),project:{project_name:'UND'},task_detail:{task_title:'QA 신규 업무'}},{id:9002,entity_id:22,project_id:2,created_at:new Date().toISOString(),project:{project_name:'무극'},task_detail:{task_title:'QA 다른 프로젝트 업무'}}],nextCursor:null}};}};
 await render(<WorkspaceNotifications source={notificationSource} actorId={'qa-'+window.innerWidth} onSelect={item=>notificationSelection=item}/>);await tick();
 document.querySelector('.notification-trigger').click();await tick();
 check(document.querySelector('.notification-list').textContent.includes('UND')&&document.querySelector('.notification-list').textContent.includes('무극'),'all-project notifications missing project labels');
 document.querySelectorAll('.notification-item')[1].click();await tick();
 check(notificationSelection?.projectId==='2'&&notificationSelection?.title==='QA 다른 프로젝트 업무','notification must select its own project');
 check(notificationCalls[0]?.workspaceNotifications===true,'workspace notification scope missing');
 results.push('portfolio notifications: multiple projects, project labels, cross-project selection');
 const FailedLazy = lazy(()=>Promise.reject(new TypeError('Failed to fetch dynamically imported module: test-only')));
 await render(<div><nav id="qa-surviving-menu">메뉴 유지</nav><ScreenBoundary key="failed-chunk"><Suspense fallback={<span>loading</span>}><FailedLazy/></Suspense></ScreenBoundary></div>);
 for(let attempt=0;attempt<50 && !document.querySelector('.screen-recovery');attempt++) await tick();
 check(document.querySelector('#qa-surviving-menu') && document.querySelector('.screen-recovery'),'lazy chunk failure blanked shell');
 check(document.querySelector('.screen-recovery').textContent.includes('SCREEN_LOAD_FAILED'),'chunk failure not classified');
 await render(<div><nav id="qa-surviving-menu">메뉴 유지</nav><ScreenBoundary key="next-route"><p id="qa-recovered-route">다른 메뉴 정상</p></ScreenBoundary></div>);
 check(document.querySelector('#qa-recovered-route'),'navigation cannot recover after chunk error');
 function BrokenScreen(){throw new Error('test-only-render-failure');}
 await render(<ScreenBoundary key="render-error"><BrokenScreen/></ScreenBoundary>);
 check(document.querySelector('.screen-recovery')?.textContent.includes('SCREEN_RENDER_FAILED'),'runtime error blanked root');
 check(!document.querySelector('.screen-recovery').textContent.includes('test-only-render-failure'),'raw error text exposed');
 results.push('white-screen recovery: rejected lazy import retains shell, route change recovers, runtime fallback hides raw errors');
 const logActor='12345678-1234-1234-1234-123456789abc';
 const logData={projects:[{id:7,project_name:'QA 프로젝트'}],actors:[{id:logActor,display_name:'QA 계정',organization_code:'NS'}],items:[{id:1,entity_id:12,project_id:7,created_at:'2026-09-08T01:00:00Z',actor_user_id:logActor,project:{project_name:'QA 프로젝트'},entity_type:'TASK',action_code:'UPDATED',event_status_code:'COMMIT',task_detail:{task_title:'블로그 원고 제작',changes:[{field:'progress_percent',before:30,after:60},{field:'status_code',before:'NOT_STARTED',after:'IN_PROGRESS'}]}}],nextCursor:null};
 const logCalls=[];const logSource={activity:async params=>{logCalls.push(params);return {data:{...logData,items:[]}};}};
 window.showLogQa=()=>render(<div style={{padding:16}}><DetailLogView initialData={logData} source={logSource}/></div>);
 await window.showLogQa();
 check(document.querySelector('.detail-log-view').textContent.includes('QA 계정'),'detail log account label missing');
 check(document.querySelector('.detail-log-task').textContent.includes('블로그 원고 제작'),'historical task name missing');
 check(document.querySelector('.detail-log-changes').textContent.includes('30%')&&document.querySelector('.detail-log-changes').textContent.includes('60%'),'before/after progress missing');
 check(document.querySelector('.detail-log-work-summary').textContent.includes('1개 업무 / 1회 저장'),'task work summary missing');
 check(document.documentElement.scrollWidth<=window.innerWidth+1,'detail log viewport overflow');
 const accountSelect=document.querySelector('.detail-log-toolbar select');accountSelect.value=logActor;accountSelect.dispatchEvent(new Event('change',{bubbles:true}));await tick();
 check(logCalls[0]?.actorId===logActor,'account filter was not sent to data source');
 check(document.querySelector('.detail-log-empty').textContent.includes('없습니다'),'filtered empty state missing');
 results.push('workspace detail log: account-labelled rows, server account filter, empty state');
 const createdData={...logData,items:[{...logData.items[0],action_code:'CREATED'},{id:2,entity_id:8,issue_context:{relatedTask:'원고 검토',body:'확인해 주세요',kind:'컨펌'},project_id:7,actor_user_id:logActor,created_at:'2026-09-08T02:00:00Z',project:{project_name:'QA 프로젝트'},entity_type:'PROJECT_ISSUE',action_code:'CREATED',event_status_code:'COMMIT'}]};
 let issueContextArgs=null;
 await render(<DetailLogView initialData={createdData} source={{activity:async params=>{issueContextArgs=params;return {data:{relatedTask:'원고 검토',body:'확인해 주세요',kind:'컨펌'}};}}}/>);
 check(document.querySelector('.detail-log-work-summary').textContent.includes('업무 생성 1건')&&document.querySelector('.detail-log-work-summary').textContent.includes('확인요청 생성 1건'),'creation counts missing');
 check(!document.querySelector('.detail-log-before'),'creation rendered as misleading change');
 check(!document.querySelector('.detail-log-diff button') && !issueContextArgs,'detail rows must not require another load action or request');
 check(document.querySelector('.detail-log-view').textContent.includes('현재 저장된 내용입니다'),'issue context must distinguish current from historical text');
 await render(<DetailLogView initialData={{...logData,items:[{...logData.items[0],task_detail:null,task_current_title:'현재 업무명 QA',detail_error_code:'PGRST202'}]}} source={{activity:async()=>{throw Error('row read forbidden');}}}/>);
 check(!document.querySelector('.detail-log-diff button') && document.querySelector('.detail-log-view').textContent.includes('PGRST202') && document.querySelector('.detail-log-task').textContent.includes('현재 업무명 QA'),'unavailable detail must show useful error and labelled current title without load button');
 results.push('detail log creation: task/request counts, creation content, authorized current request context');
 for(const visible of [true,false]) {
  await render(<div className="has-sidebar-workspace" style={{width:visible?264:56}}><ProjectSidebar project={{id:1,name:'QA',allowedPages:['progress']}} role="client" activeView="client-progress" visible={visible} navigation={{actionLabel:'메뉴',controlledIds:'project-navigation-content'}} onToggleNavigation={()=>{}} onClose={()=>{}} onView={()=>{}}/></div>);
  const mark=document.querySelector('.sidebar-company-symbol');
  check(Boolean(mark)===visible,'sidebar symbol must only appear when expanded');
  if(visible) { const title=document.querySelector('.sidebar-menu-brand strong');const toggle=document.querySelector('.sidebar-toggle');check(mark.getBoundingClientRect().right<=title.getBoundingClientRect().left,'symbol overlaps sidebar title');check(title.getBoundingClientRect().right<=toggle.getBoundingClientRect().left,'sidebar title overlaps toggle'); }
 }
 results.push('sidebar symbol: expanded only, title/toggle do not overlap');
 await render(<IssueTabsQa/>);
 check(document.querySelectorAll('.issue-request-card').length===1,'open requests mixed with completed');
 check(!/원장 편집|카드로 보기/.test(document.body.textContent),'legacy ledger toggle still visible');
 const cardAction=(text)=>[...document.querySelectorAll('.issue-request-actions button')].find(button=>button.textContent.includes(text));
 cardAction('확인 완료').click();await tick();
 check(!document.querySelector('.issue-request-card'),'completed request did not leave open list');
 document.querySelectorAll('.project-issue-status-tabs button')[1].click();await tick();
 check(document.querySelectorAll('.issue-request-card').length===2,'completed tab missing saved request');
 check(document.querySelector('.issue-request-card h3').textContent==='대기 요청','newest request must be first');
 cardAction('다시 확인 요청').click();await tick();
 check(document.querySelectorAll('.issue-request-card').length===1,'reopened request remained completed');
 document.querySelectorAll('.project-issue-status-tabs button')[0].click();await tick();
 check(document.querySelector('.issue-request-card h3').textContent==='대기 요청','reopened request missing');
 results.push('task confirmation tabs: open/completed filtering, save moves rows, reopen, counts and newest order');
 await window.showIssueQa();
 document.querySelector('.issue-request-reply-action').click();await tick();
 check(document.querySelector('.issue-request-reply-form textarea'),'reply editor missing');
 document.querySelector('.issue-request-deadline button').click();await tick();
 check(document.querySelector('.issue-request-deadline-form input'),'deadline editor missing');
 check(document.documentElement.scrollWidth<=window.innerWidth+1,'request editors overflow viewport');
 results.push('readable confirmation card: 18px title, 15px body, reply/deadline editors and responsive wrapping');
 await render(<div className="has-sidebar-workspace" style={{width:264}}><ProjectSidebar project={{id:1,name:'QA'}} role="ns" activeView="files" visible navigation={{actionLabel:'메뉴',controlledIds:'project-navigation-content'}} onToggleNavigation={()=>{}} onClose={()=>{}} onView={()=>{}}/></div>);
 check([...document.querySelectorAll('.sidebar-global-nav strong')].map(el=>el.textContent).join(',')==='통합 관리,권한 관리,세부 로그','workspace navigation order incorrect');
 check(!document.querySelector('.sidebar-current-project'),'workspace log still highlights project');
 for(const activeView of ['tasks','portfolio','daily','client-progress','files','permissions']) {
await render(<div className="has-sidebar-workspace" style={{width:'calc(100vw - 56px)'}}><Topbar project={{id:1,clientName:'UND',name:'UND 통합 마케팅 운영 프로젝트'}} activeView={activeView} actor={{name:'포켓컴퍼니',organization:'POCKET'}} search="" setSearch={()=>{}} notificationTasks={[]} notificationsLoaded={true} onNotificationSelect={()=>{}} onLogout={()=>{}} live={true}/></div>);
  const brand=document.querySelector('.topbar-company-brand'); const context=document.querySelector('.topbar-project-context'); const actions=document.querySelector('.topbar-actions');
  for(let attempt=0;attempt<50&&!brand.querySelector('img').complete;attempt++) await tick();
  check(brand.querySelector('img').naturalWidth>0,'company logo failed to load');
  check(brand.getBoundingClientRect().right<=context.getBoundingClientRect().left,'logo overlaps project context');
  check(context.getBoundingClientRect().right<=actions.getBoundingClientRect().left,'project overlaps header actions');
  check(document.documentElement.scrollWidth<=window.innerWidth+1,'branded topbar overflows viewport');
 }
 results.push('shared branded topbar: image loaded, project to right, no overlap on task/portfolio/daily/client routes');
 await render(<Overview projectId="A"/>);
 await tick();
 check(overviewCalls.length===1 && !overviewCalls[0].signal.aborted,'loading state must not restart overview request');
 await render(<Overview projectId="B"/>);
 check(overviewCalls.length===2 && overviewCalls[0].signal.aborted,'project switch must cancel old request');
 overviewCalls[1].resolve({data:{summary:{tasks:{total:2}}}}); await tick();
 overviewCalls[0].resolve({data:{summary:{tasks:{total:99}}}}); await tick();
 check(overviewState.projectId==='B' && overviewState.data.project.metrics[0].value==='2건','late overview response replaced current project');
 check(overviewCalls.length===2,'ready state restarted overview');
 results.push('overview: one request, project cancellation, stale response ignored');
 const secret=deferred(); let reveals=0;
 const props={project:{id:'A'},credentials:[{id:'same-id',siteName:'QA 사이트',accountIdentifier:'qa@example.invalid'}],canWrite:true,onReveal:()=>{reveals++;return secret.promise;},onSave:async()=>{},onArchive:async()=>{}};
 await render(<CredentialLedgerView {...props}/>);
 const reveal=document.querySelector('[aria-label="QA 사이트 비밀번호 보기"]'); reveal.click(); reveal.click(); await tick();
 check(reveals===1,'duplicate reveal RPC');
 await render(<CredentialLedgerView {...props} project={{id:'B'}}/>);
 secret.resolve('QA-ONLY-OLD-SECRET'); await tick();
 check(!document.body.textContent.includes('QA-ONLY-OLD-SECRET'),'old password crossed project boundary');
 document.querySelector('[aria-label="QA 사이트 수정"]').click(); await tick();
 check(document.querySelector('[role="dialog"]'),'credential editor missing');
 await render(<CredentialLedgerView {...props} project={{id:'C'}}/>);
 check(!document.querySelector('[role="dialog"]'),'old project editor survived project switch');
 await render(<CredentialLedgerView {...props} project={{id:'D'}} onReveal={async()=> 'QA-CURRENT-SECRET'}/>);
 document.querySelector('[aria-label="QA 사이트 비밀번호 보기"]').click(); await tick();
 check(document.body.textContent.includes('QA-CURRENT-SECRET'),'current password did not reveal');
 document.querySelector('[aria-label="QA 사이트 비밀번호 숨기기"]').click(); await tick();
 check(!document.body.textContent.includes('QA-CURRENT-SECRET'),'password did not hide');
 results.push('credentials: deduplicated reveal, late response blocked, editor reset, show/hide');
 await render(<Suspense fallback={<div>Loading</div>}><QuoteImportModal currentProject={{id:'A'}} onClose={()=>{}} onCreateProject={async()=>{}} onAppendProject={async()=>{}}/></Suspense>);
 for(let i=0;i<100 && !document.querySelector('#quote-import-title');i++) await tick();
 check(document.querySelector('#quote-import-title')?.textContent==='견적서 불러오기','lazy quote modal missing');
 const transfer=new DataTransfer();
 transfer.items.add(new File(['고객사,QA 고객사\\n캠페인,QA 캠페인\\n매체,항목,세부내용,수량,단위,금액\\nYouTube,본편 업로드,SEO 세팅,2,건,200000원'], 'qa.csv',{type:'text/csv'}));
 const input=document.querySelector('input[type="file"]'); input.files=transfer.files; input.dispatchEvent(new Event('change',{bubbles:true}));
 for(let i=0;i<100 && !document.querySelector('.quote-item-table');i++) await tick();
 check(document.querySelector('.quote-item-table tbody tr'),'quote parsing/render failed');
 check([...document.querySelectorAll('button')].some(button=>button.textContent==='새 프로젝트로 만들기' && !button.disabled),'quote creation controls unavailable');
 results.push('quote: lazy modal, CSV parsing, review table, enabled creation controls');
 await render(<PermissionsView access={{accounts:[],projects:[{id:'A',name:'QA 프로젝트'}]}} role="ns" onSave={async()=>{}}/>);
 [...document.querySelectorAll('button')].find(button=>button.textContent.includes('고객사 계정 생성')).click();await tick();
 check(document.querySelector('.access-page-groups'),'extracted permission controls missing');
 check(document.querySelector('.access-account-modal').getBoundingClientRect().width<=window.innerWidth,'permission dialog overflows');
 check(!document.querySelector('.access-account-modal').textContent.includes('계정 비활성화'),'NS has account-disable control');
 results.push('permissions: separate module, project grants, responsive creation dialog, NS boundary');
 await render(<ProjectIssuePanel issues={[]} project={{id:'A',clientName:'QA 회사'}} canWrite={true} actorName="QA" onCreate={async()=>{}}/>);
 document.querySelector('.project-issue-add').click();
 for(let i=0;i<100 && !document.querySelector('[role="dialog"]');i++) await tick();
 check(document.querySelector('[role="dialog"]'),'lazy confirmation request modal missing');
 check(document.querySelector('[role="dialog"] select'),'confirmation request controls missing');
 results.push('issues: actual project panel opens lazy request dialog');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const page=tasksViewModel({data:{items:Array.from({length:8},(_,index)=>({task_id:index+1,project_id:1,title:'공개 업무 '+(index+1),description:'고객에게 공개된 업무 내용',category_code:'YOUTUBE',workstream_code:'MARKETING',status_mode:'MANUAL',status_code:index===7?'NOT_STARTED':index===6?'IN_PROGRESS':'DONE',progress_percent:index<6?100:30,planned_start_date:today,due_date:today,visibility_code:'CLIENT',updated_at:today,completion_url:'https://example.com/result'})),totalMatching:8,project:{project_id:1}}});
 await render(<ProjectClientProgressView project={{id:1,name:'QA 고객 공개 프로젝트'}} taskPage={page}/>);
 for(let i=0;i<100 && !document.querySelector('.client-progress-view .reference-gantt');i++) await tick();
 check(document.querySelector('.client-progress-view'),'client progress route did not render');
 check(document.querySelector('.client-progress-view .reference-gantt'),'customer Gantt missing');
 check(document.querySelectorAll('.pb-flow-column').length===3,'customer workflow must have three columns');
 check(!/회의|확인 안건|안건 추가|업무에서 수정|전체 업무 보기/.test(document.querySelector('.client-progress-view').textContent),'internal content/actions on customer page');
 check(!document.querySelector('.client-progress-view select, .client-progress-view input, .client-progress-view textarea'),'customer page has edit controls');
 const more=document.querySelector('.client-progress-view .pb-more');check(more,'completed list expansion missing');more.click();await tick();
 check(document.querySelectorAll('.pb-flow-column.is-done .pb-task').length===6,'expand does not reveal completed tasks');
 const taskRow=document.querySelector('.pb-task');
 const rowHeight=taskRow.getBoundingClientRect().height;
 check(rowHeight<=45,'workflow row is not compact: '+rowHeight);
 const summary=taskRow.querySelector('summary');
 check(summary.querySelector('.pb-flow-description')?.textContent==='고객에게 공개된 업무 내용','collapsed flow must show task description instead of refresh date');
 check(!summary.textContent.includes('갱신'),'refresh date still shown in work flow');
 check(document.querySelector('.pb-flow-column.is-planned .pb-flow-date')?.textContent.includes('마감'),'planned deadline must remain visible');
 summary.click();await tick();
 check(taskRow.open && taskRow.querySelector('.pb-flow-detail').getBoundingClientRect().height>0,'task details cannot be expanded');
 check(!taskRow.querySelector('.pb-flow-detail').textContent.includes('NS'),'customer detail exposes internal owner');
 summary.click();await tick();check(!taskRow.open,'task details cannot be collapsed');
 check(taskRow.querySelector('.pb-flow-link')?.href==='https://example.com/result','completion link missing in compact row');
 check(document.documentElement.scrollWidth<=window.innerWidth+1,'customer page overflows viewport');
 results.push('client progress: actual read-only Gantt, compact rows '+rowHeight+'px, expand/collapse details, completion links, no internal panels/editors, no viewport overflow');
 return results;
};
window.showBrandQa = async () => {
 await render(<div className="has-sidebar-workspace" style={{width:'calc(100vw - 56px)',marginLeft:56,background:'white'}}><Topbar project={{id:1,clientName:'UND',name:'UND 통합 마케팅 운영'}} activeView="tasks" actor={{name:'포켓컴퍼니',role:'pocket'}} search="" setSearch={()=>{}} notificationTasks={[]} notificationsLoaded={true} onNotificationSelect={()=>{}} onLogout={()=>{}} live={true}/></div>);
 await tick();
};
`, resolveDir: process.cwd(), loader: "jsx" },
  bundle: true, write: false, outfile: "qa.js", format: "esm", jsx: "automatic", loader: { '.png': 'dataurl' },
  define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
});
const assets = new Map(bundle.outputFiles.map(file => [`/${path.basename(file.path)}`, file.contents]));
const server = createServer((request,response) => {
  const asset=assets.get(request.url);
  response.setHeader("Content-Type",request.url?.endsWith('.css') ? "text/css" : asset ? "text/javascript" : "text/html");
  response.end(asset || '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/qa.css"></head><body><div id="root"></div><script type="module" src="/qa.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const url=`http://127.0.0.1:${server.address().port}`;
const debugPort=Number(process.env.CDP_PORT || 9349);
const profile=await mkdtemp(path.join(tmpdir(),"pocket-review-qa-"));
const chromePath=process.env.CHROME_PATH || (process.platform==='win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : ['/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(existsSync));
if(!chromePath)throw Error('Chrome not found; set CHROME_PATH');
const chrome=spawn(chromePath,[
  '--headless=new','--disable-gpu','--disable-dev-shm-usage',...(process.env.CI ? ['--no-sandbox'] : []),`--remote-debugging-port=${debugPort}`,`--user-data-dir=${profile}`,'about:blank',
],{stdio:['ignore','ignore','pipe'],windowsHide:true});
let chromeStartupError='';
chrome.stderr.on('data',chunk=>{chromeStartupError=(chromeStartupError+chunk.toString()).slice(-4000);});
chrome.on('error',error=>{chromeStartupError=error.message;});
let socket;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try {
  let ready=false;
  const startupDeadline=Date.now()+30000;
  while(Date.now()<startupDeadline) { try { ready=(await fetch(`http://127.0.0.1:${debugPort}/json/version`,{signal:AbortSignal.timeout(1000)})).ok; } catch {} if(ready||chrome.exitCode!==null)break;await delay(100); }
  if(!ready)throw Error('headless Chrome failed to start within 30s: '+chromeStartupError);
  const target=await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`,{method:'PUT'})).json();
  socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let id=0;const pending=new Map();const errors=[];
  socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const done=pending.get(message.id);pending.delete(message.id);message.error?done?.reject(Error(message.error.message)):done?.resolve(message.result);}else if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const next=++id;pending.set(next,{resolve,reject});socket.send(JSON.stringify({id:next,method,params}));});
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url});
  for(let i=0;i<100;i++){if(await evaluate('typeof window.runLargeListQa === "function"'))break;await delay(100);}
  console.log(JSON.stringify({largeList:await evaluate('window.runLargeListQa()')}));
  if(process.env.BENCHMARK_UI==='1') {
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    await send('Page.navigate',{url});
    for(let i=0;i<100;i++){if(await evaluate('typeof window.benchmarkQa === "function"'))break;await delay(100);}
    const benchmark=await evaluate('window.benchmarkQa()');
    await mkdir('../artifacts/client-progress',{recursive:true});
    await writeFile('../artifacts/client-progress/render-benchmark.json',JSON.stringify(benchmark,null,2));
    console.log(JSON.stringify({benchmark}));
  }
  for(const width of [1440,1024,390]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<500});
    await send('Page.navigate',{url});
    for(let i=0;i<100;i++){if(await evaluate('typeof window.runQa === "function"'))break;await delay(100);}
    console.log(JSON.stringify({viewport:width,localSort:await evaluate('window.runLocalSortQa()')}));
    const sortShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await mkdir('../artifacts/client-progress',{recursive:true});
    await writeFile('../artifacts/client-progress/local-sort-'+width+'.png',Buffer.from(sortShot.data,'base64'));
    console.log(JSON.stringify({viewport:width,checklist:await evaluate('window.runChecklistQa()')}));
    console.log(JSON.stringify({viewport:width,meeting:await evaluate('window.runMeetingEmphasisQa()')}));
    const meetingShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await mkdir('../artifacts/client-progress',{recursive:true});
    await writeFile('../artifacts/client-progress/meeting-emphasis-'+width+'.png',Buffer.from(meetingShot.data,'base64'));
    console.log(JSON.stringify({viewport:width,blog:await evaluate('window.runBlogQa()')}));
    const blogShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await mkdir('../artifacts/client-progress',{recursive:true});
    await writeFile(`../artifacts/client-progress/blog-${width}.png`,Buffer.from(blogShot.data,'base64'));
    const result=await evaluate('window.runQa()');
    const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await mkdir('../artifacts/client-progress',{recursive:true});
    await writeFile(`../artifacts/client-progress/qa-${width}.png`,Buffer.from(screenshot.data,'base64'));
    console.log(JSON.stringify({viewport:width,checks:result}));
    await evaluate('window.showRequestBodyQa()');
    await evaluate('document.querySelector(".ops-issue-panel").scrollIntoView({block:"center"})');
    const requestBodyShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(`../artifacts/client-progress/request-body-${width}.png`,Buffer.from(requestBodyShot.data,'base64'));
    await evaluate('window.showChoiceQa()');
    const choiceShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(`../artifacts/client-progress/task-choice-${width}.png`,Buffer.from(choiceShot.data,'base64'));
    await evaluate('window.showBrandQa()');
    const brandShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(`../artifacts/client-progress/brand-${width}.png`,Buffer.from(brandShot.data,'base64'));
    await evaluate('window.showIssueQa()');
    const issueShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(`../artifacts/client-progress/issue-${width}.png`,Buffer.from(issueShot.data,'base64'));
    await evaluate('window.showLogQa()');
    const logShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(`../artifacts/client-progress/detail-log-${width}.png`,Buffer.from(logShot.data,'base64'));
  }
  if(errors.length)throw Error(errors.join('; '));
} finally {
  socket?.close();chrome.kill();server.closeAllConnections();server.close();
}
