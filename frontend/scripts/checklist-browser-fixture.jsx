import React from 'react';
import ChecklistDashboard from '../src/ChecklistDashboard.jsx';
import { checklistBucket, checklistToday } from '../src/checklistModel.js';

async function runManualChecklistQa(render, tick, check) {
  const today = checklistToday(), old = new Date(Date.now() - 8 * 86400000).toISOString();
  let rows = Array.from({ length: 12 }, (_, i) => ({ id: `row-${String(i).padStart(2, '0')}`, project_id: i % 2 + 1, task_date: i === 0 ? '2000-01-01' : today, title: `회의 후속 요청 ${i + 1}`, completed_at: null, created_by_name: '포켓 담당자', row_version: 1 }));
  rows.push({ id: 'old', project_id: 1, task_date: today, title: '일주일 지난 완료 항목', completed_at: old, row_version: 1 });
  const projects = [{ id: 1, navigation_id: 'PRJ-A', client_name: '테스트 A', name: 'A 운영 프로젝트', canWrite: true }, { id: 2, navigation_id: 'PRJ-B', client_name: '테스트 B', name: 'B 운영 프로젝트', canWrite: true }];
  const boards = { 1: { body: '홈페이지: https://example.test\n어드민: https://example.test/admin\n<script>alert(1)</script>', row_version: 1, updated_at: new Date().toISOString() } };
  const writes = [], replays = new Map(); let failAfterCommit = false, failRead = false, readonly = false, delaySave = null;
  const source = {
    checklist: async ({ projectId, bucket, cursor, limit = 10 }) => {
      if (failRead) throw Error('조회 실패 테스트');
      const scoped = rows.filter(r => !r.archived_at && (!projectId || r.project_id === Number(projectId)));
      const compare = (a, b) => Number(Boolean(a.completed_at)) - Number(Boolean(b.completed_at)) || a.task_date.localeCompare(b.task_date) || a.id.localeCompare(b.id);
      let list = scoped.filter(r => checklistBucket(r) === bucket).sort(compare);
      if (cursor) list = list.filter(r => compare(r, { completed_at: cursor.completed, task_date: cursor.date, id: cursor.id }) > 0);
      const last = list[limit - 1], pending = scoped.filter(r => !r.completed_at);
      return { data: { today, summary: { pending: pending.length, overdue: pending.filter(r => r.task_date < today).length, today: pending.filter(r => r.task_date === today).length }, projects: projects.map(p => ({ ...p, canWrite: !readonly })), items: structuredClone(list.slice(0, limit)), next_cursor: list.length > limit ? { completed: Boolean(last.completed_at), date: last.task_date, id: last.id } : null } };
    },
    checklistBoard: async ({ projectId }) => ({ data: { item: structuredClone(boards[projectId] || null), canWrite: !readonly } }),
    saveChecklist: async request => {
      writes.push(structuredClone(request));
      if (delaySave) await delaySave;
      if (replays.has(request.mutationId)) return replays.get(request.mutationId);
      let item;
      if (request.kind === 'BOARD') {
        item = boards[request.projectId] = { body: request.body.text, row_version: (request.rowVersion || 0) + 1, updated_at: new Date().toISOString() };
      } else {
        const current = rows.find(r => r.id === request.id);
        if (current && current.row_version !== request.rowVersion) throw Object.assign(Error('다른 사람이 수정했습니다.'), { code: 'conflict' });
        item = { ...current, id: request.id, project_id: request.projectId, title: request.body.title ?? current?.title, task_date: request.body.date ?? current?.task_date, created_by_name: current?.created_by_name || 'NS 담당자', row_version: (request.rowVersion || 0) + 1, completed_at: request.body.completed ? current?.completed_at || new Date().toISOString() : null, completed_by_name: request.body.completed ? 'NS 담당자' : null, archived_at: request.operation === 'ARCHIVE' ? new Date().toISOString() : null };
        rows = [...rows.filter(r => r.id !== item.id), item];
      }
      const response = { data: { item: structuredClone(item) } }; replays.set(request.mutationId, response);
      if (failAfterCommit) { failAfterCommit = false; throw Error('응답을 확인하지 못했습니다.'); }
      return response;
    },
  };
  const findButton = text => [...document.querySelectorAll('.checklist-dashboard button,.checklist-dialog button')].find(b => b.textContent.trim() === text);
  const field = (selector, value) => {
    const el = document.querySelector(selector);
    check(el, `field ${selector} exists`);
    const prototype = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(el, value); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  };
  const settle = async () => { await tick(); await tick(); };
  const originalConfirm = window.confirm; window.confirm = () => true;
  try {
    const navigations=[];
    await render(<div/>); await render(<ChecklistDashboard source={source} onOpenProject={(...args)=>navigations.push(args)}/>); await settle();
    findButton('아이디 관리대장').click(); check(navigations[0]?.[0]==='PRJ-A'&&navigations[0]?.[1]==='credentials','credential navigation uses existing app project ID');
    check(document.querySelectorAll('[data-checklist-id]').length === 10, 'first ten automatically loaded');
    check(document.querySelector('[data-checklist-id]').dataset.checklistId === 'row-00' && document.querySelector('.checklist-deadline.is-overdue')?.textContent === '기한 지남', 'overdue deadline leads the list');
    check(document.querySelector('.checklist-summary').textContent.includes('12') && document.querySelector('.checklist-task-meta').textContent.includes('포켓 담당자'), 'whole-list summary and creator visible');
    check(document.querySelector('.checklist-board-content a')?.getAttribute('href') === 'https://example.test/', 'board links automatically visible');
    check(!document.querySelector('.checklist-board-content script'), 'board markup escaped');
    document.querySelector('.checklist-more').click(); await settle();
    check(document.querySelectorAll('[data-checklist-id]').length === 12, 'more continues without duplication');
    findButton('완료').click(); await settle(); check(document.querySelectorAll('[data-checklist-id]').length === 1 && document.body.textContent.includes('일주일 지난 완료 항목'), 'completed bucket');
    document.querySelector('.checklist-check-cell input').click(); await settle();
    check(!document.querySelector('[data-checklist-id]'), 'uncheck removes from completed bucket');
    findButton('할 일').click(); await settle();
    failAfterCommit = true; document.querySelector('.checklist-check-cell input').click(); await settle();
    const lastMutation = writes.at(-1).mutationId;
    check(document.querySelector('.checklist-error'), 'uncertain save shown');
    findButton('같은 요청 다시 시도').click(); findButton('같은 요청 다시 시도')?.click(); await settle();
    check(writes.at(-1).mutationId === lastMutation && writes.filter(w => w.mutationId === lastMutation).length === 2, 'retry uses identical id and prevents double click');
    const doneId = writes.at(-1).id;
    check(findButton('완료 취소') && rows.find(r => r.id === doneId).completed_at, 'one-click completion exposes immediate undo');
    findButton('완료 취소').click(); await settle();
    check(!rows.find(r => r.id === doneId).completed_at && !findButton('완료 취소'), 'undo restores pending with canonical version');
    findButton('할 일 추가').click(); await tick();
    field('.checklist-dialog textarea', '신규 확인할 사항'); field('.checklist-dialog select', '2'); await tick();
    check(document.querySelector('[role=dialog]'), 'accessible add dialog');
    findButton('저장').click(); findButton('저장')?.click(); await settle();
    check(rows.filter(r => r.title === '신규 확인할 사항').length === 1, 'single create');
    [...document.querySelectorAll('.checklist-projects button')].find(b => b.textContent === '테스트 B').click(); await settle();
    check([...document.querySelectorAll('[data-checklist-id]')].every(el => rows.find(r => r.id === el.dataset.checklistId).project_id === 2), 'project classification');
    const row = document.querySelector('[data-checklist-id]'), rowId = row.dataset.checklistId;
    row.querySelector('.checklist-task-title').click(); await tick(); field('.checklist-dialog textarea', '수정한 요청'); field('.checklist-dialog select', '1'); await tick(); findButton('저장').click(); await settle();
    check(rows.find(r => r.id === rowId).project_id === 1 && !document.querySelector(`[data-checklist-id="${rowId}"]`), 'edit reassigns one row');
    findButton('보드 수정').click(); await tick(); field('.checklist-board textarea', 'B 보드 메모\nhttps://example.test/b'); await tick();
    window.confirm = () => false;
    findButton('전체 프로젝트').click(); await tick(); check(document.querySelector('.checklist-board textarea'), 'dirty board blocks filter navigation');
    window.confirm = () => true; findButton('보드 저장').click(); await settle();
    check(boards[2].body.includes('B 보드 메모') && boards[1].body.includes('홈페이지'), 'project-specific board persisted');
    findButton('보드 수정').click(); await tick(); field('.checklist-board textarea', '폐기할 초안'); await tick();
    boards[2].body = '다른 계정의 최신 보드'; findButton('취소').click(); await settle();
    check(document.querySelector('.checklist-board-content').textContent === boards[2].body, 'cancel refreshes latest board without stale editing guard');
    const toDelete = document.querySelector('[data-checklist-id]').dataset.checklistId;
    document.querySelector('.checklist-remove').click(); await settle();
    check(rows.find(r => r.id === toDelete).archived_at && !document.querySelector(`[data-checklist-id="${toDelete}"]`), 'delete archives only chosen row');
    // Conflict leaves draft intact; no forced overwrite or extra write on close.
    document.querySelector('.checklist-task-title').click(); await tick();
    const editTitle = document.querySelector('.checklist-dialog textarea').value;
    rows.find(r => r.title === editTitle).row_version++;
    field('.checklist-dialog textarea', '충돌 시 유지할 초안'); await tick(); findButton('저장').click(); await settle();
    check(document.querySelector('.checklist-dialog textarea').value === '충돌 시 유지할 초안' && document.querySelector('.checklist-dialog [role=alert]'), 'conflict keeps draft');
    findButton('취소').click(); await settle();
    readonly = true; await render(<div/>); await render(<ChecklistDashboard source={source}/>); await settle();
    check(!findButton('할 일 추가') && !findButton('보드 수정') && [...document.querySelectorAll('.checklist-check-cell input')].every(e => e.disabled), 'readonly controls');
    failRead = true; await render(<div/>); await render(<ChecklistDashboard source={source}/>); await settle();
    check(document.querySelector('[role=alert]') && !document.querySelector('[data-checklist-id]'), 'load error is not empty success');
    failRead = false; readonly = false; findButton('다시 시도').click(); await settle();
    check(document.querySelectorAll('[data-checklist-id]').length === 10, 'read error recovery');
    check(document.documentElement.scrollWidth <= innerWidth + 1, 'no page-level horizontal overflow');
    return 'ten/more, completion/reopen, project move, safe boards, create/edit/archive, retry/conflict, dirty guard, readonly, failure recovery passed';
  } finally { window.confirm = originalConfirm; }
}

export async function runChecklistQa(render, tick, check) {
  const manualResult = await runManualChecklistQa(render, tick, check);
  const today=checklistToday(), projects=[{id:1,navigation_id:'PRJ-A',client_name:'테스트 프로젝트',name:'운영 프로젝트',canWrite:true}];
  let rows=[
    {id:'task:321',source_id:'321',row_kind:'TASK',project_id:1,title:'업무표에 등록된 콘텐츠 업로드',task_date:'2026-09-25',row_version:2,is_complete:false,status_code:'ON_HOLD',execution_month:'2026-09-01',created_by_name:'NS 담당자'},
    {id:'task:322',source_id:'322',row_kind:'TASK',project_id:1,title:'일정 미정인 광고 소재 검토',task_date:null,row_version:1,is_complete:false,status_code:'NOT_STARTED',execution_month:'2026-10-01'},
    {id:'manual',row_kind:'ITEM',project_id:1,title:'회의 중 직접 추가한 확인사항',task_date:today,row_version:1,completed_at:null},
  ];
  const writes=[],notified=[],opened=[],replays=new Map(); let readonly=false,failAfterCommit=false,reads=0;
  const source={
    checklist:async()=>{reads++;return {data:{today,projects:projects.map(p=>({...p,canWrite:!readonly})),items:structuredClone([...rows].sort((a,b)=>Number(Boolean(a.completed_at))-Number(Boolean(b.completed_at))||(a.task_date||'9999').localeCompare(b.task_date||'9999'))),next_cursor:null}};},
    checklistBoard:async()=>({data:{item:null,canWrite:!readonly}}),
    saveChecklist:async()=>{throw Error('task must not be copied into manual checklist');},
    mutate:async request=>{
      writes.push(structuredClone(request));
      if(replays.has(request.mutationId))return replays.get(request.mutationId);
      const row=rows.find(r=>r.source_id===request.mutation.id);
      if(row.row_version!==request.mutation.expectedRowVersion)throw Object.assign(Error('다른 사람이 수정했습니다.'),{code:'conflict'});
      row.status_code=request.mutation.fields.status_code;row.is_complete=row.status_code==='DONE';row.completed_at=row.is_complete?new Date().toISOString():null;row.completed_by_name=row.is_complete?'NS 담당자':null;row.row_version++;
      const response={data:{record:{...row,id:Number(row.source_id),due_date:row.task_date}}};replays.set(request.mutationId,structuredClone(response));
      if(failAfterCommit){failAfterCommit=false;throw Error('응답을 확인하지 못했습니다.');}
      return response;
    },
  };
  const settle=async()=>{await tick();await tick();};
  const taskRow=()=>document.querySelector('[data-checklist-id="task:321"]');
  await render(<div/>);await render(<ChecklistDashboard source={source} onOpenProject={(...args)=>opened.push(args)} onTaskSaved={id=>notified.push(id)}/>);await settle();
  check(reads===1&&document.querySelectorAll('[data-checklist-id]').length===3,'registered and manual tasks load automatically in same table');
  check(taskRow().textContent.includes('업무표')&&!taskRow().querySelector('.checklist-remove'),'registered source label with no duplicate editor/delete');
  check(document.querySelector('[data-checklist-id="task:322"]').textContent.includes('마감일 미정'),'undated task visible');
  taskRow().querySelector('.checklist-task-title').click();await tick();
  check(opened.at(-1)?.join('|')==='PRJ-A|schedule|2026-09-01'&&!document.querySelector('[role=dialog]'),'original task opens own project and execution month');
  taskRow().querySelector('input').click();await settle();
  check(writes.length===1&&JSON.stringify(writes[0].mutation.fields)==='{"status_code":"DONE"}'&&notified.at(-1)==='PRJ-A','canonical status-only task mutation invalidates right project');
  check(taskRow().querySelector('input').checked&&taskRow().textContent.includes('완료 체크 NS 담당자'),'server completion and checker visible');
  document.querySelector('.checklist-undo').click();await settle();
  check(rows[0].status_code==='ON_HOLD'&&!taskRow().querySelector('input').checked,'immediate undo restores prior hold status');
  failAfterCommit=true;taskRow().querySelector('input').click();await settle();
  const retryId=writes.at(-1).mutationId;
  [...document.querySelectorAll('button')].find(b=>b.textContent==='같은 요청 다시 시도').click();await settle();
  check(writes.at(-1).mutationId===retryId&&rows[0].row_version===5,'uncertain task retry never repeats completion mutation');
  document.querySelector('.checklist-undo').click();await settle();
  rows[0].row_version++;taskRow().querySelector('input').click();await settle();
  check(document.querySelector('[role=alert]')&&!taskRow().querySelector('input').checked,'stale canonical task remains unchanged');
  [...document.querySelectorAll('button')].find(b=>b.textContent==='최신 목록 확인').click();await settle();
  readonly=true;await render(<div/>);await render(<ChecklistDashboard source={source}/>);await settle();
  check([...document.querySelectorAll('.checklist-check-cell input')].every(el=>el.disabled),'registered tasks respect readonly');
  readonly=false;await render(<div/>);await render(<ChecklistDashboard source={source} onOpenProject={()=>{}}/>);await settle();
  check(document.documentElement.scrollWidth<=innerWidth+1,'mixed checklist no viewport overflow');
  return `${manualResult}; original tasks, status/undo/retry/conflict, source labels, undated, project/month navigation and cache invalidation passed`;
}
