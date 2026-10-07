import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, Check, ChevronDown, ClipboardCheck, ExternalLink, KeyRound, Pencil, Plus, Trash2, Undo2, X } from 'lucide-react';
import { useDialogSurface } from './useDialogSurface.js';
import { startWorkspaceRefresh } from './workspaceRefresh.js';
import { boardSegments, checklistDraft, checklistRequest, checklistProjectRoute, checklistDeadline } from './checklistModel.js';
import './checklistDashboard.css';

const isDenied = error => ['forbidden', 'unauthorized'].includes(error?.code);
const uncertain = error => !['forbidden', 'unauthorized', 'conflict', '22023', '22007', '22008', '23514'].includes(error?.code);
const projectLabel = project => project?.client_name || project?.name || '프로젝트';
const timestamp = value => value ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '';

function useLeaveGuard(dirty, busy) {
  const current = useRef({ dirty, busy }); current.current = { dirty, busy };
  useEffect(() => {
    const navigate = event => { if (current.current.busy || (current.current.dirty && !window.confirm('저장하지 않은 내용이 있습니다. 이 화면을 나가시겠습니까?'))) event.preventDefault(); };
    const unload = event => { if (current.current.busy || current.current.dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('pocket:before-navigate', navigate); window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('pocket:before-navigate', navigate); window.removeEventListener('beforeunload', unload); };
  }, []);
}

// An uncertain response retains exactly the same request and mutation ID on retry.
function useChecklistWriter(source, onSaved) {
  const request = useRef(null), lock = useRef(false), alive = useRef(true), saved = useRef(onSaved); saved.current = onSaved;
  const [busy, setBusy] = useState(false), [error, setError] = useState(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function save(input) {
    if (lock.current) return;
    request.current ||= input;
    if (!request.current) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      const result = await source.saveChecklist(request.current);
      request.current = null;
      if (alive.current) { setError(null); saved.current?.(result.data); }
    } catch (failure) { if (alive.current) setError(failure); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  const reset = () => { if (lock.current) return; request.current = null; setError(null); };
  return { save, busy, error, reset, pending: Boolean(request.current), frozen: busy || Boolean(error && (uncertain(error) || error.code === 'conflict' || isDenied(error))) };
}

function SaveError({ writer }) {
  return writer.error ? <div className="checklist-error" role="alert"><span>{writer.error.message}</span>{uncertain(writer.error) && <button type="button" disabled={writer.busy} onClick={() => writer.save()}>같은 요청 다시 시도</button>}{writer.error.code === 'conflict' && <small>작성 내용은 유지됩니다. 필요한 내용을 복사하고 닫은 뒤 다시 열어 주세요.</small>}</div> : null;
}

function ItemEditor({ item, projects, defaultProject, source, onClose, onSaved }) {
  const initial = useRef(checklistDraft(item, defaultProject));
  const [draft, setDraft] = useState(initial.current), dialog = useRef(null), current = useRef(null);
  const writer = useChecklistWriter(source, onSaved);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial.current);
  current.current = { dirty, writer };
  const close = useCallback(() => {
    const { dirty, writer } = current.current;
    if (writer.busy) return;
    if ((dirty || writer.pending) && !window.confirm('작성한 내용 또는 확인되지 않은 저장 결과가 있습니다. 닫으시겠습니까?')) return;
    onClose();
  }, [onClose]);
  useDialogSurface(true, dialog, close); useLeaveGuard(dirty || writer.pending, writer.busy);
  const change = (field, value) => { if (!writer.frozen) { writer.reset(); setDraft(d => ({ ...d, [field]: value })); } };
  return <div className="checklist-backdrop"><section className="checklist-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="checklist-editor-title" tabIndex={-1}>
    <header><div><small>회의 후속 체크리스트</small><h2 id="checklist-editor-title">{item ? '할 일 수정' : '할 일 추가'}</h2></div><button type="button" data-dialog-close aria-label="닫기" disabled={writer.busy} onClick={close}><X size={18}/></button></header>
    <form onSubmit={event => { event.preventDefault(); if (!writer.frozen) void writer.save(checklistRequest(draft, item)); }}>
      <div className="checklist-dialog-body"><div className="checklist-form-pair"><label>마감일<input type="date" name="date" required min="2000-01-01" max="2100-12-31" value={draft.date} disabled={writer.frozen} onChange={e => change('date', e.target.value)}/></label><label>프로젝트<select name="project" required value={draft.projectId} disabled={writer.frozen} onChange={e => change('projectId', e.target.value)}>{projects.filter(p => p.canWrite).map(p => <option key={p.id} value={p.id}>{projectLabel(p)} · {p.name}</option>)}</select></label></div>
      <label>할 일<textarea name="title" required maxLength={1000} rows={4} value={draft.title} readOnly={writer.frozen} placeholder="회의에서 요청한 내용과 완료 기준을 적어 주세요." onChange={e => change('title', e.target.value)}/></label>
      <label className="checklist-completed-field"><input type="checkbox" checked={draft.completed} disabled={writer.frozen} onChange={e => change('completed', e.target.checked)}/>완료한 할 일</label>
      <SaveError writer={writer}/></div><footer><button type="button" disabled={writer.busy} onClick={close}>취소</button><button className="checklist-primary" disabled={writer.frozen || !draft.title.trim() || !draft.projectId}>{writer.busy ? '저장 중…' : '저장'}</button></footer>
    </form></section></div>;
}

function ProjectBoard({ project, source, onOpenProject, onEditingChange }) {
  const [state, setState] = useState({ loading: true, item: null, canWrite: false, error: null });
  const [editing, setEditing] = useState(false), [text, setText] = useState(''), [notice, setNotice] = useState('');
  const controller = useRef(null), root = useRef(null), editingRef = useRef(false), writerRef = useRef(null);
  editingRef.current = editing;
  const load = useCallback(async () => {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    try {
      const result = await source.checklistBoard({ projectId: project.id, signal: abort.signal });
      if (!abort.signal.aborted && !editingRef.current) setState({ ...result.data, loading: false, error: null });
    } catch (error) { if (!abort.signal.aborted) setState(s => ({ ...s, loading: false, error, ...(isDenied(error) ? { item: null, canWrite: false } : {}) })); }
  }, [source, project.id]);
  const writer = useChecklistWriter(source, data => { setState(s => ({ ...s, item: data.item, error: null })); setEditing(false); setNotice('저장 완료'); });
  writerRef.current = writer;
  const dirty = editing && text !== (state.item?.body || '');
  useLeaveGuard(dirty || writer.pending, writer.busy);
  useEffect(() => { onEditingChange(editing || writer.pending || writer.busy); return () => onEditingChange(false); }, [editing, writer.pending, writer.busy, onEditingChange]);
  useEffect(() => {
    void load(); const stop = startWorkspaceRefresh({ refresh: load, busy: () => editingRef.current || writerRef.current?.pending });
    return () => { controller.current?.abort(); stop(); };
  }, [load]);
  const cancel = () => {
    if (writer.busy || ((dirty || writer.pending) && !window.confirm('보드의 작성 내용을 저장하지 않고 닫으시겠습니까?'))) return;
    writer.reset(); editingRef.current = false; setEditing(false); setNotice(''); void load();
  };
  return <section className="checklist-board" ref={root} aria-label={`${projectLabel(project)} 자유보드`}>
<header><div><span className="checklist-project-pill">{projectLabel(project)}</span><h2>프로젝트 자유보드</h2><p>{project.name}</p></div><div className="checklist-board-actions">{onOpenProject && <button type="button" onClick={() => onOpenProject(checklistProjectRoute(project), 'credentials')}><KeyRound size={14}/>아이디 관리대장</button>}{state.canWrite && !editing && <button onClick={() => { controller.current?.abort(); setText(state.item?.body || ''); setNotice(''); setEditing(true); }}><Pencil size={14}/>보드 수정</button>}</div></header>
    <p className="checklist-board-help">계정 페이지·홈페이지·어드민 주소와 운영 메모를 자유롭게 기록하세요. 비밀번호는 아이디 관리대장에 보관하세요.</p>
    {state.loading ? <p role="status">보드를 불러오는 중…</p> : state.error ? <div className="checklist-error" role="alert">{state.error.message}<button onClick={load}>다시 시도</button></div> : editing ? <form onSubmit={e => { e.preventDefault(); if (!writer.frozen) void writer.save({ kind: 'BOARD', projectId: project.id, body: { text }, rowVersion: state.item?.row_version ?? null, mutationId: crypto.randomUUID() }); }}>
      <textarea aria-label="자유보드 내용" maxLength={10000} rows={8} value={text} readOnly={writer.frozen} onChange={e => { writer.reset(); setText(e.target.value); }} placeholder={'홈페이지: https://…\n어드민 주소: https://…\n운영 메모:'}/><SaveError writer={writer}/>
      <footer><small>{text.length.toLocaleString()} / 10,000</small><button type="button" disabled={writer.busy} onClick={cancel}>취소</button><button className="checklist-primary" disabled={writer.frozen || !dirty}>{writer.busy ? '저장 중…' : '보드 저장'}</button></footer>
    </form> : <div className={`checklist-board-content${state.item?.body ? '' : ' is-empty'}`}>{state.item?.body ? boardSegments(state.item.body).map((part, i) => part.href ? <a key={i} href={part.href} target="_blank" rel="noopener noreferrer">{part.text}<ExternalLink size={11}/></a> : <span key={i}>{part.text}</span>) : '아직 작성된 내용이 없습니다.'}</div>}
    {!editing && <footer><small>{state.item?.updated_at ? `마지막 수정 ${timestamp(state.item.updated_at)}` : '프로젝트별로 따로 저장됩니다. · 내부 공유'}</small><span role="status">{notice}</span></footer>}
  </section>;
}

export default function ChecklistDashboard({ source, onOpenProject }) {
  const [projectId, setProjectId] = useState(''), [bucket, setBucket] = useState('active'), [boardId, setBoardId] = useState('');
  const [state, setState] = useState({ loading: true, items: [], projects: [], next_cursor: null, error: null });
  const [editor, setEditor] = useState(null), [notice, setNotice] = useState(''), [undo, setUndo] = useState(null);
  const controller = useRef(null), latest = useRef(null), boardEditing = useRef(false), view = useRef(null);
  const onBoardEditing = useCallback(value => { boardEditing.current = value; }, []);
  const load = useCallback(async ({ more = false, refresh = false } = {}) => {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    setState(s => ({ ...s, loading: true, error: null, ...(!more && !refresh ? { items: [], summary: null, next_cursor: null } : {}) }));
    try {
      const result = await source.checklist({ projectId: projectId || null, bucket, cursor: more ? latest.current.state.next_cursor : null, limit: refresh ? Math.min(200, Math.max(10, latest.current.state.items.length)) : 10, signal: abort.signal });
      if (abort.signal.aborted) return;
      setState(s => ({ ...result.data, loading: false, error: null, items: more ? [...s.items, ...result.data.items.filter(n => !s.items.some(o => o.id === n.id))] : result.data.items }));
      setBoardId(id => result.data.projects.some(p => String(p.id) === id) ? id : String(result.data.projects[0]?.id || ''));
    } catch (error) { if (!abort.signal.aborted) setState(s => ({ ...s, loading: false, error, ...(isDenied(error) ? { items: [], projects: [], summary: null, next_cursor: null } : {}) })); }
  }, [source, projectId, bucket]);
  const writer = useChecklistWriter(source, data => {
    const item = data.item;
    setUndo(item?.completed_at && !item.archived_at ? item : null);
    setNotice(item?.archived_at ? '삭제 완료' : item?.completed_at ? '완료 체크됨' : '저장 완료');
    void load({ refresh: true });
  });
  latest.current = { state, editor, writer };
  useLeaveGuard(writer.pending, writer.busy);
  useEffect(() => { void load(); return () => controller.current?.abort(); }, [load]);
  useEffect(() => startWorkspaceRefresh({ refresh: () => load({ refresh: true }), busy: () => {
    const s = latest.current; return s.state.loading || s.state.items.length > 200 || s.editor || s.writer.pending || s.writer.busy || boardEditing.current || view.current?.querySelector('input:not([type=checkbox]):focus,textarea:focus,select:focus');
  } }), [load]);
  const boardProject = state.projects.find(p => String(p.id) === (projectId || boardId));
  const writableProjects = state.projects.filter(p => p.canWrite);
  const locked = writer.busy || writer.pending;
  const changeProject = id => {
    if (locked || !window.dispatchEvent(new Event('pocket:before-navigate', { cancelable: true }))) return;
    setNotice(''); setUndo(null); setProjectId(id); if (id) setBoardId(id);
  };
  const closeEditor = useCallback(() => { setEditor(null); void load({ refresh: true }); }, [load]);
  const saveEditor = () => { setEditor(null); setUndo(null); setNotice('저장 완료'); void load({ refresh: true }); };
  return <div className="checklist-dashboard" ref={view}>
    <header className="checklist-heading"><div><h1><ClipboardCheck size={23}/>체크리스트</h1><p>회의에서 정한 할 일, 완료까지 함께 확인합니다.</p></div>{Boolean(writableProjects.length) && <button className="checklist-primary" disabled={locked} onClick={() => setEditor({ item: null })}><Plus size={16}/>할 일 추가</button>}</header>
    <nav className="checklist-projects" aria-label="체크리스트 프로젝트"><button aria-pressed={!projectId} onClick={() => changeProject('')} disabled={locked}>전체 프로젝트</button>{state.projects.map(p => <button key={p.id} aria-pressed={String(p.id) === projectId} title={p.name} onClick={() => changeProject(String(p.id))} disabled={locked}>{projectLabel(p)}</button>)}</nav>
    <section className="checklist-panel" aria-label="할 일 목록">
      <div className="checklist-toolbar"><div className="checklist-buckets"><button aria-pressed={bucket === 'active'} disabled={locked} onClick={() => { setBucket('active'); setUndo(null); setNotice(''); }}>할 일</button><button aria-pressed={bucket === 'completed'} disabled={locked} onClick={() => { setBucket('completed'); setUndo(null); setNotice(''); }}>완료</button></div><p>{bucket === 'active' ? '미완료 먼저 · 마감일 순 · 완료 후 7일간 유지' : '완료한 지 7일 지난 항목입니다. 체크를 해제하면 할 일로 돌아갑니다.'}</p><span role="status">{notice}</span>{undo && state.projects.some(p => p.id === undo.project_id && p.canWrite) && <button className="checklist-undo" disabled={locked} title={undo.title} onClick={() => void writer.save(checklistRequest({ ...checklistDraft(undo), completed: false }, undo))}><Undo2 size={13}/>완료 취소</button>}</div>
      {state.summary && <div className="checklist-summary" aria-label="선택 프로젝트 전체 현황"><span>미완료 <strong>{state.summary.pending}</strong></span><span className={state.summary.overdue ? 'is-overdue' : ''}>기한 지남 <strong>{state.summary.overdue}</strong></span><span>오늘 마감 <strong>{state.summary.today}</strong></span></div>}
      {state.error && <div className="checklist-error" role="alert">{state.error.message}<button onClick={() => load()}>다시 시도</button></div>}
      {writer.error && <><SaveError writer={writer}/><button className="checklist-dismiss" onClick={() => { if (!uncertain(writer.error) || window.confirm('저장이 반영되었을 수도 있습니다. 요청을 닫고 최신 목록을 확인하시겠습니까?')) { writer.reset(); void load({ refresh: true }); } }}>최신 목록 확인</button></>}
      <div className="checklist-table-scroll"><table><colgroup><col className="checklist-date-col"/><col/><col className="checklist-project-col"/><col className="checklist-check-col"/></colgroup><thead><tr><th>마감일</th><th>할 일</th><th>프로젝트명</th><th>완료 체크</th></tr></thead><tbody>{state.items.map(item => {
        const p = state.projects.find(p => String(p.id) === String(item.project_id));
        const deadline = checklistDeadline(item, state.today);
        return <tr key={item.id} className={item.completed_at ? 'is-complete' : deadline ? `is-${deadline.kind}` : ''} data-checklist-id={item.id}>
          <td><span className="checklist-date"><CalendarDays size={13}/>{item.task_date.replaceAll('-', '.')}</span>{deadline && <small className={`checklist-deadline is-${deadline.kind}`}>{deadline.label}</small>}</td>
          <td><div className="checklist-task-cell">{p?.canWrite ? <button className="checklist-task-title" disabled={locked} onClick={() => setEditor({ item })}>{item.title}<Pencil size={12}/></button> : <span className="checklist-task-title">{item.title}</span>}{p?.canWrite && <button className="checklist-remove" aria-label={`${item.title} 삭제`} disabled={locked} onClick={() => { if (window.confirm(`“${item.title}” 할 일을 삭제하시겠습니까?`)) void writer.save({ ...checklistRequest(checklistDraft(item), item), operation: 'ARCHIVE', body: {} }); }}><Trash2 size={13}/></button>}</div>{(item.created_by_name || item.completed_at) && <div className="checklist-task-meta">{item.created_by_name && <span>등록 {item.created_by_name}</span>}{item.completed_at && <span>완료 체크 {item.completed_by_name || '계정 기록 없음'} · {timestamp(item.completed_at)}</span>}</div>}</td>
          <td><button className="checklist-project-pill" disabled={locked} onClick={() => changeProject(String(item.project_id))}>{projectLabel(p)}</button></td>
          <td className="checklist-check-cell"><input type="checkbox" aria-label={`${item.title} 완료 체크`} title={item.completed_at ? `완료 ${timestamp(item.completed_at)} · 클릭하면 다시 할 일로` : '완료 체크'} checked={Boolean(item.completed_at)} disabled={!p?.canWrite || locked} onChange={event => void writer.save(checklistRequest({ ...checklistDraft(item), completed: event.target.checked }, item))}/></td>
        </tr>;
      })}</tbody></table></div>
      {state.loading && <p className="checklist-empty" role="status">체크리스트를 불러오는 중…</p>}
      {!state.loading && !state.error && !state.items.length && <div className="checklist-empty"><Check size={23}/><strong>{bucket === 'active' ? '등록된 할 일이 없습니다.' : '완료 보관함이 비어 있습니다.'}</strong><span>{bucket === 'active' ? '할 일을 추가하고 프로젝트를 지정해 주세요.' : '완료 체크 후 7일이 지나면 자동으로 여기에 표시됩니다.'}</span></div>}
      {state.next_cursor && <button className="checklist-more" disabled={state.loading || locked} onClick={() => void load({ more: true })}><ChevronDown size={16}/>더보기 <small>10개씩 · 현재 {state.items.length}개</small></button>}
    </section>
    {Boolean(state.projects.length) && <div className="checklist-board-zone">{!projectId && <label className="checklist-board-picker">프로젝트 자유보드<select aria-label="자유보드 프로젝트" value={boardId} onChange={e => { if (window.dispatchEvent(new Event('pocket:before-navigate', { cancelable: true }))) setBoardId(e.target.value); }}>{state.projects.map(p => <option key={p.id} value={p.id}>{projectLabel(p)} · {p.name}</option>)}</select></label>}{boardProject && <ProjectBoard key={boardProject.id} project={boardProject} source={source} onOpenProject={onOpenProject} onEditingChange={onBoardEditing}/>}</div>}
    {editor && <ItemEditor item={editor.item} projects={state.projects} defaultProject={writableProjects.find(p => String(p.id) === projectId)?.id || writableProjects[0]?.id} source={source} onClose={closeEditor} onSaved={saveEditor}/>}
  </div>;
}
