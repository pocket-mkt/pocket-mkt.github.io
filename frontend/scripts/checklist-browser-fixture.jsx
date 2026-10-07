import React from 'react';
import ChecklistDashboard from '../src/ChecklistDashboard.jsx';
import { checklistBucket } from '../src/checklistModel.js';

export async function runChecklistQa(render, tick, check) {
  const today = new Date().toISOString().slice(0, 10), old = new Date(Date.now() - 8 * 86400000).toISOString();
  let rows = Array.from({ length: 12 }, (_, i) => ({ id: `row-${String(i).padStart(2, '0')}`, project_id: i % 2 + 1, task_date: today, title: `회의 후속 요청 ${i + 1}`, completed_at: null, row_version: 1 }));
  rows.push({ id: 'old', project_id: 1, task_date: today, title: '일주일 지난 완료 항목', completed_at: old, row_version: 1 });
  const projects = [{ id: 1, navigation_id: 'PRJ-A', client_name: '테스트 A', name: 'A 운영 프로젝트', canWrite: true }, { id: 2, navigation_id: 'PRJ-B', client_name: '테스트 B', name: 'B 운영 프로젝트', canWrite: true }];
  const boards = { 1: { body: '홈페이지: https://example.test\n어드민: https://example.test/admin\n<script>alert(1)</script>', row_version: 1, updated_at: new Date().toISOString() } };
  const writes = [], replays = new Map(); let failAfterCommit = false, failRead = false, readonly = false, delaySave = null;
  const source = {
    checklist: async ({ projectId, bucket, cursor, limit = 10 }) => {
      if (failRead) throw Error('조회 실패 테스트');
      let list = rows.filter(r => !r.archived_at && (!projectId || r.project_id === Number(projectId)) && checklistBucket(r) === bucket).sort((a, b) => a.id.localeCompare(b.id));
      if (cursor) list = list.filter(r => r.id > cursor.id);
      return { data: { projects: projects.map(p => ({ ...p, canWrite: !readonly })), items: structuredClone(list.slice(0, limit)), next_cursor: list.length > limit ? { date: today, id: list[limit - 1].id } : null } };
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
        item = { ...current, id: request.id, project_id: request.projectId, title: request.body.title, task_date: request.body.date, row_version: (request.rowVersion || 0) + 1, completed_at: request.body.completed ? current?.completed_at || new Date().toISOString() : null, archived_at: request.operation === 'ARCHIVE' ? new Date().toISOString() : null };
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
