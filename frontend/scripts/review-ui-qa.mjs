// Isolated browser regression: no real login, DB writes, or user's browser profile.
import { build } from "esbuild";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const bundle = await build({
  stdin: { contents: `
import React, { lazy, Suspense, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CredentialLedgerView } from './src/CredentialLedgerView.jsx';
import { useOverviewResource } from './src/useOverviewResource.js';
import { ProjectIssuePanel, ProjectClientProgressView } from './src/App.jsx';
import { tasksViewModel } from './src/api/viewModel.js';
import './src/styles.css';
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
function Overview({projectId}) {
 const [state,setState]=useState({status:'idle'});
 const [session,setSession]=useState(null);
 overviewState=state;
 useOverviewResource({source,activeProjectId:projectId,view:'overview',bootstrapState,actorRole:'client',overviewState:state,pageRefreshKey:0,setOverviewState:setState,setSession});
 return <div>{state.projectId}:{state.status}</div>;
}
window.runQa = async () => {
 const results=[];
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
 const summary=taskRow.querySelector('summary');summary.click();await tick();
 check(taskRow.open && taskRow.querySelector('.pb-flow-detail').getBoundingClientRect().height>0,'task details cannot be expanded');
 check(!taskRow.querySelector('.pb-flow-detail').textContent.includes('NS'),'customer detail exposes internal owner');
 summary.click();await tick();check(!taskRow.open,'task details cannot be collapsed');
 check(taskRow.querySelector('.pb-flow-link')?.href==='https://example.com/result','completion link missing in compact row');
 check(document.documentElement.scrollWidth<=window.innerWidth+1,'customer page overflows viewport');
 results.push('client progress: actual read-only Gantt, compact rows '+rowHeight+'px, expand/collapse details, completion links, no internal panels/editors, no viewport overflow');
 return results;
};
`, resolveDir: process.cwd(), loader: "jsx" },
  bundle: true, write: false, outfile: "qa.js", format: "esm", jsx: "automatic",
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
const chrome=spawn(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',[
  '--headless=new','--disable-gpu',`--remote-debugging-port=${debugPort}`,`--user-data-dir=${profile}`,'about:blank',
],{stdio:'ignore',windowsHide:true});
let socket;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try {
  let ready=false;
  for(let i=0;i<80;i++) { try { ready=(await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok; } catch {} if(ready)break;await delay(100); }
  if(!ready)throw Error('headless Chrome failed to start');
  const target=await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`,{method:'PUT'})).json();
  socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let id=0;const pending=new Map();const errors=[];
  socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const done=pending.get(message.id);pending.delete(message.id);message.error?done?.reject(Error(message.error.message)):done?.resolve(message.result);}else if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const next=++id;pending.set(next,{resolve,reject});socket.send(JSON.stringify({id:next,method,params}));});
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
  await send('Runtime.enable'); await send('Page.enable');
  for(const width of [1440,390]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<500});
    await send('Page.navigate',{url});
    for(let i=0;i<100;i++){if(await evaluate('typeof window.runQa === "function"'))break;await delay(100);}
    const result=await evaluate('window.runQa()');
    const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await mkdir('../artifacts/client-progress',{recursive:true});
    await writeFile(`../artifacts/client-progress/qa-${width}.png`,Buffer.from(screenshot.data,'base64'));
    console.log(JSON.stringify({viewport:width,checks:result}));
  }
  if(errors.length)throw Error(errors.join('; '));
} finally {
  socket?.close();chrome.kill();server.closeAllConnections();server.close();
}
