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
import { createRoot } from 'react-dom/client';
import { CredentialLedgerView } from './src/CredentialLedgerView.jsx';
import { useOverviewResource } from './src/useOverviewResource.js';
import { ProjectClientProgressView, Topbar, ProjectSidebar } from './src/App.jsx';
import { ProjectIssuePanel, TaskScheduleTimeline } from './src/TaskWorkspace.jsx';
import PermissionsView from './src/PermissionsView.jsx';
import IssueRequestCard from './src/IssueRequestCard.jsx';
import DetailLogView from './src/DetailLogView.jsx';
import ScreenBoundary from './src/ScreenBoundary.jsx';
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
window.runQa = async () => {
 const results=[];
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
 const logData={actors:[{id:logActor,display_name:'QA 계정',organization_code:'NS'}],items:[{id:1,created_at:'2026-09-08T01:00:00Z',actor_user_id:logActor,project:{project_name:'QA 프로젝트'},entity_type:'TASK',action_code:'UPDATED',event_status_code:'COMMIT'}],nextCursor:null};
 const logCalls=[];const logSource={activity:async params=>{logCalls.push(params);return {data:{...logData,items:[]}};}};
 window.showLogQa=()=>render(<div style={{padding:16}}><DetailLogView initialData={logData} source={logSource}/></div>);
 await window.showLogQa();
 check(document.querySelector('.detail-log-view').textContent.includes('QA 계정'),'detail log account label missing');
 const accountSelect=document.querySelector('.detail-log-toolbar select');accountSelect.value=logActor;accountSelect.dispatchEvent(new Event('change',{bubbles:true}));await tick();
 check(logCalls[0]?.actorId===logActor,'account filter was not sent to data source');
 check(document.querySelector('.detail-log-empty').textContent.includes('없습니다'),'filtered empty state missing');
 results.push('workspace detail log: account-labelled rows, server account filter, empty state');
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
  for(const width of [1440,390]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<500});
    await send('Page.navigate',{url});
    for(let i=0;i<100;i++){if(await evaluate('typeof window.runQa === "function"'))break;await delay(100);}
    const result=await evaluate('window.runQa()');
    const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await mkdir('../artifacts/client-progress',{recursive:true});
    await writeFile(`../artifacts/client-progress/qa-${width}.png`,Buffer.from(screenshot.data,'base64'));
    console.log(JSON.stringify({viewport:width,checks:result}));
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
