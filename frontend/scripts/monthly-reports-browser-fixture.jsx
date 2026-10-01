import React from 'react';
import MonthlyReportsView from '../src/MonthlyReportsView.jsx';
import { ProjectSidebar } from '../src/App.jsx';
import { taskMonthKey, shiftTaskMonth } from '../src/taskMonth.js';

export async function runMonthlyReportsQa(render, tick, check) {
  const current = taskMonthKey(new Date()), previous = shiftTaskMonth(current, -1);
  const records = new Map(); const writes = []; let failSave = false, failRead = false, writer = true;
  const html = name => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>body{margin:0;padding:28px;font-family:Arial,sans-serif;color:#172a45;background:#f7f9fc}header{border-bottom:1px solid #dce5f0;padding-bottom:18px}small{color:#657997}h1{font-size:25px}.grid{display:flex;gap:14px;margin-top:25px}.card{flex:1;padding:20px;border:1px solid #dce5f0;background:white;border-radius:12px}.card b{display:block;font-size:28px;margin-top:14px}table{margin-top:26px;background:white;border-collapse:collapse;width:100%}td,th{padding:15px;text-align:left;border-bottom:1px solid #e3e9f1}@media(max-width:600px){body{padding:18px}.grid{flex-direction:column}}</style></head><body><header><small>QA 전용 예시 · 실제 성과 데이터 아님</small><h1>${name} 마케팅 성과</h1><p>광고·콘텐츠 → 유입 → 전환</p></header><div class="grid"><div class="card">전체 유입<b>1,280</b></div><div class="card">문의 전환<b>64</b></div><div class="card">전환율<b>5.0%</b></div></div><table><tr><th>채널</th><th>유입</th><th>전환</th></tr><tr><td>네이버</td><td>780</td><td>41</td></tr><tr><td>인스타그램</td><td>500</td><td>23</td></tr></table><script>let blocked=false;try{parent.document.body.dataset.reportEscaped='yes'}catch(e){blocked=true}parent.postMessage({type:'report-isolation-qa',blocked,name:'${name}'},'*')</script></body></html>`;
  const put = (month, published = true) => records.set(month, { month:month+'-01', title:`QA ${month} 성과 보고서`, file_name:'report.html', published, row_version:1, updated_at:'2026-10-01T03:12:00Z', html:html(month) });
  put(current); put(previous);
  for(let i=2;i<14;i++)put(shiftTaskMonth(current,-i));
  const source = {
    monthlyReports: async () => ({data:{items:[...records.values()].filter(r=>writer||r.published).sort((a,b)=>b.month.localeCompare(a.month)).map(({html,...metadata})=>metadata),canWrite:writer,nextMonth:null}}),
    monthlyReport: async ({month}) => { if(failRead){failRead=false;const e=Error('QA 연결 실패');e.code='network_error';throw e} return {data:{item:records.get(month)||null}}; },
    saveMonthlyReport: async params => {
      writes.push(params); if(failSave){failSave=false;throw Error('QA 업로드 실패')}
      if(params.operation==='ARCHIVE')records.delete(params.month);else records.set(params.month,{month:params.month+'-01',title:params.title,file_name:params.fileName,html:params.html,published:params.published,row_version:(records.get(params.month)?.row_version||0)+1,updated_at:'2026-10-01T03:13:00Z'});
      return {data:{saved:true}};
    },
  };
  const project = {id:'reports-qa',clientName:'QA 프로젝트',name:'QA 운영',permissionCode:'EDIT',allowedPages:['plan','progress','performance']};
  const settle = async () => {for(let i=0;i<5;i++)await tick()};
  let isolation; const listener = e => {if(e.data?.type==='report-isolation-qa'&&e.source===document.querySelector('.monthly-report-viewer iframe')?.contentWindow)isolation=e.data;};
  window.addEventListener('message',listener);
  const originalConfirm=window.confirm;window.confirm=()=>true;
  try {
    await render(<MonthlyReportsView project={project} source={source} canWrite />);await settle();
    const monthBar=document.querySelector('.monthly-report-months').getBoundingClientRect(),uploadButton=document.querySelector('.monthly-report-upload-trigger').getBoundingClientRect();
    check(Math.abs((monthBar.top+monthBar.bottom)/2-(uploadButton.top+uploadButton.bottom)/2)<2,'month buttons and upload are not on the same row');
    check(document.querySelector('.monthly-report-month-options').scrollWidth>document.querySelector('.monthly-report-month-options').clientWidth,'long month list did not scroll within toolbar');
    check(Math.abs(document.querySelector('.monthly-report-viewer').getBoundingClientRect().width-document.querySelector('.monthly-reports-view').getBoundingClientRect().width)<2,'report still leaves space for left month rail');
    check(document.querySelector('[data-report-month="'+current+'"]').getAttribute('aria-pressed')==='true','latest report not selected');
    check(document.querySelector('iframe')?.getAttribute('sandbox')==='allow-scripts','report sandbox missing or same-origin permitted');
    await settle();check(isolation?.blocked && !document.body.dataset.reportEscaped,'HTML escaped into parent app');
    const doc=document.querySelector('iframe').srcdoc;
    check(doc.indexOf('Content-Security-Policy')<doc.indexOf('<script>'),'CSP not before uploaded script');
    document.querySelector('[data-report-month="'+previous+'"]').click();await settle();
    check(document.querySelector('iframe').srcdoc.includes(previous),'month click did not open report automatically');
    failRead=true;document.querySelector('[data-report-month="'+current+'"]').click();await settle();
    check(!document.querySelector('iframe')&&document.body.textContent.includes('QA 연결 실패'),'failed read showed old month content');
    [...document.querySelectorAll('button')].find(b=>b.textContent.includes('다시 시도')).click();await settle();check(document.querySelector('iframe'),'read retry failed');
    const frame=document.querySelector('iframe');
    [...document.querySelectorAll('.monthly-report-actions button')].find(b=>b.textContent==='전체화면').click();await tick();
    check(document.querySelector('.monthly-report-viewer[role=dialog]')&&document.querySelector('iframe')===frame,'viewer fullscreen recreated report');
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await tick();check(!document.querySelector('.monthly-report-viewer[role=dialog]'),'viewer Escape failed');
    [...document.querySelectorAll('button')].find(b=>b.textContent==='HTML 보고서 업로드').click();await tick();
    const fileInput=document.querySelector('input[type=file]'), transfer=new DataTransfer();transfer.items.add(new File([html('업로드 QA')],'upload.html',{type:'text/html'}));fileInput.files=transfer.files;fileInput.dispatchEvent(new Event('change',{bubbles:true}));await settle();
    check(document.querySelector('.monthly-report-upload').textContent.includes('upload.html'),'file not accepted');
    failSave=true;document.querySelector('.monthly-report-upload').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await settle();
    check(document.querySelector('.monthly-report-upload')&&document.body.textContent.includes('QA 업로드 실패'),'failed upload lost draft');
    document.querySelector('.monthly-report-upload').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await settle();
    check(writes.length===2&&writes[0].mutationId===writes[1].mutationId,'save retry changed mutation ID');
    check(!document.querySelector('.monthly-report-upload')&&document.querySelector('iframe').srcdoc.includes('업로드 QA'),'saved report did not open');
    document.querySelector('[aria-label="보고서 삭제"]').click();await settle();
    check(!document.querySelector('[data-report-month="'+current+'"]'),'deleted report still in list');
    writer=false;put(current,false);await render(<div/>);await render(<MonthlyReportsView project={project} source={source} canWrite={false}/>);await settle();
    check(!document.querySelector('[data-report-month="'+current+'"]'),'customer draft visible');
    check(!document.querySelector('.monthly-report-upload-trigger,.monthly-report-actions [aria-label="보고서 삭제"]'),'customer upload/delete visible');
    const navigations=[];
    const sidebar=(role,activeView='reports')=><ProjectSidebar project={project} role={role} activeView={activeView} activePlanVariant="client" onView={(...args)=>navigations.push(args)} open visible onClose={()=>{}} onSelectClient={()=>{}} onToggleNavigation={()=>{}} navigation={{actionLabel:'접기'}} clients={[]} />;
    await render(sidebar('pocket'));await tick();
    check(document.querySelector('#project-page-links')&&!document.querySelector('#project-page-links').textContent.includes('클라이언트'),'internal project group wrong');
    const shared=document.querySelector('#client-sharing-links');check(shared.textContent.includes('월별 마케팅 성과')&&!shared.textContent.includes('KPI 성과'),'sharing group wrong');
    check(document.querySelector('#project-page-links').textContent.includes('KPI 성과'),'internal KPI menu missing');
    [...shared.querySelectorAll('button')].find(b=>b.textContent==='실행계획').click();check(navigations.at(-1)[0]==='plan'&&navigations.at(-1)[1]==='client','shared plan route wrong');
    [...document.querySelectorAll('button')].find(b=>b.textContent==='실행계획 · 내부').click();check(navigations.at(-1)[1]==='internal','internal plan route wrong');
    await render(sidebar('client'));await tick();check(!document.body.textContent.includes('KPI 성과'),'KPI still visible in customer navigation');
    project.allowedPages=['progress'];
    await render(sidebar('client'));await tick();
    check(!document.body.textContent.includes('아이디 관리대장')&&!document.body.textContent.includes('실행계획 · 내부')&&!document.body.textContent.includes('통합 관리'),'customer internal navigation leaked');
    check(document.querySelector('#client-sharing-links').textContent.includes('월별 마케팅 성과'),'authorized customer reports missing');
    await render(<MonthlyReportsView project={project} source={source} canWrite={false}/>);await settle();
    check(document.documentElement.scrollWidth<=innerWidth+1,'reports overflow viewport');
    return ['automatic month opening, opaque sandbox, failed-read retry, fullscreen state, HTML upload/replace retry ID, archive, client draft/write boundaries, sharing navigation'];
  } finally {window.confirm=originalConfirm;window.removeEventListener('message',listener);}
}
