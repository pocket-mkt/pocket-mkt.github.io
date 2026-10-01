import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Check, FileUp, Maximize2, Minimize2, Trash2, X } from 'lucide-react';
import { EmptyState, LoadingState, ErrorState } from './TaskUiPrimitives.jsx';
import { taskMonthKey } from './taskMonth.js';
import { useDialogSurface } from './useDialogSurface.js';
import { MAX_REPORT_BYTES, reportDocument, reportMonthLabel, validateReportFile } from './monthlyReports.js';
import './monthlyReports.css';

const timestamp = value => value ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '';

export default function MonthlyReportsView({ project, source, canWrite }) {
  const [list, setList] = useState({ loading: true, items: [], nextMonth: null, canWrite: false, error: null });
  const [month, setMonth] = useState('');
  const [report, setReport] = useState({ loading: false, item: null, error: null });
  const [reportRevision, setReportRevision] = useState(0);
  const [upload, setUpload] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const viewerRef = useRef(null), uploadRef = useRef(null), listController = useRef(null);
  const pending = useRef(null), archivePending = useRef(null), writeLock = useRef(false), fileGeneration = useRef(0);
  const [draft, setDraft] = useState({ month: taskMonthKey(new Date()), title: '', file: null, html: '', published: true });
  const [saving, setSaving] = useState(false), [formError, setFormError] = useState(''), [reading, setReading] = useState(false);
  const closeViewer = useCallback(() => setFullscreen(false), []);
  const closeUpload = useCallback(() => {
    if (writeLock.current) return;
    if ((uploadRef.current?.querySelector('input[type="file"]')?.files.length || pending.current) && !window.confirm(pending.current ? '업로드 결과를 아직 확인하지 못했습니다. 다시 시도하지 않고 닫으시겠습니까?' : '선택한 보고서 파일을 업로드하지 않고 닫으시겠습니까?')) return;
    fileGeneration.current++; setUpload(false); pending.current = null; setDraft({ month: taskMonthKey(new Date()), title: '', file: null, html: '', published: true });
  }, []);
  useDialogSurface(fullscreen, viewerRef, closeViewer);
  useDialogSurface(upload, uploadRef, closeUpload);
  const writer = canWrite && list.canWrite;
  useEffect(() => { if (!list.loading && !list.items.length) setFullscreen(false); }, [list.loading, list.items.length]);

  const loadList = useCallback(async (beforeMonth = null) => {
    listController.current?.abort();
    const controller = new AbortController(); listController.current = controller;
    try {
      const result = await source.monthlyReports({ projectId: project.id, beforeMonth, signal: controller.signal });
      if (controller.signal.aborted) return;
      const data = result.data;
      setList(previous => ({ ...data, loading: false, error: null, items: beforeMonth ? [...previous.items, ...data.items.filter(item => !previous.items.some(old => old.month === item.month))] : data.items }));
      if (!beforeMonth) setMonth(current => data.items.some(item => item.month.slice(0, 7) === current) ? current : data.items[0]?.month.slice(0, 7) || '');
    } catch (error) {
      if (controller.signal.aborted) return;
      setList(previous => ({ ...previous, loading: false, error, ...(error.code === 'forbidden' || error.code === 'unauthorized' ? { items: [], canWrite: false } : {}) }));
    }
  }, [source, project.id]);
  useEffect(() => {
    void loadList();
    const refresh = () => { if (document.visibilityState !== 'hidden' && !writeLock.current && !uploadRef.current && !viewerRef.current?.contains(document.activeElement)) void loadList(); };
    const timer = setInterval(refresh, 60000); window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); listController.current?.abort(); fileGeneration.current++; };
  }, [loadList]);
  const metadata = list.items.find(item => item.month.slice(0, 7) === month);
  useEffect(() => {
    const controller = new AbortController();
    setReport({ loading: Boolean(month && metadata), item: null, error: null });
    if (month && metadata) source.monthlyReport({ projectId: project.id, month, signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setReport({ loading: false, item: result.data.item, error: null });
    }).catch(error => { if (!controller.signal.aborted) setReport({ loading: false, item: null, error }); });
    return () => controller.abort();
  }, [source, project.id, month, metadata?.row_version, reportRevision]);
  const srcDoc = useMemo(() => report.item ? reportDocument(report.item.html) : '', [report.item]);
  const openUpload = (replace = false) => {
    setDraft({ month: replace ? month : taskMonthKey(new Date()), title: replace ? metadata.title : '', file: null, html: '', published: replace ? metadata.published : true });
    pending.current = null; setFormError(''); setUpload(true);
  };
  const pickFile = async file => {
    const generation = ++fileGeneration.current;
    pending.current = null; setFormError(''); setReading(true); setDraft(current => ({ ...current, file: null, html: '' }));
    try {
      if (!file || file.size > MAX_REPORT_BYTES) throw Error('3MB 이하의 HTML 파일을 선택해 주세요.');
      const html = await file.text(); validateReportFile(file, html);
      if (generation === fileGeneration.current) setDraft(current => ({ ...current, file, html }));
    } catch (error) { if (generation === fileGeneration.current) setFormError(error.message); }
    finally { if (generation === fileGeneration.current) setReading(false); }
  };
  const save = async event => {
    event.preventDefault(); if (writeLock.current || !writer || !draft.file) return;
    const existing = list.items.find(item => item.month.slice(0, 7) === draft.month);
    const fields = { month: draft.month, title: draft.title.trim() || `${project.clientName || project.name} ${reportMonthLabel(draft.month)} 마케팅 성과`, fileName: draft.file.name, html: draft.html, published: draft.published, rowVersion: existing?.row_version ?? null };
    const signature = JSON.stringify(fields);
    if (!pending.current || pending.current.signature !== signature) {
      if (existing && !window.confirm(`${reportMonthLabel(draft.month)} 보고서를 새 파일로 교체하시겠습니까?`)) return;
      pending.current = { signature, params: { ...fields, mutationId: crypto.randomUUID() } };
    }
    writeLock.current = true; setSaving(true); setFormError('');
    try {
      await source.saveMonthlyReport({ projectId: project.id, ...pending.current.params });
      pending.current = null; fileGeneration.current++; setUpload(false); setDraft({ month: taskMonthKey(new Date()), title: '', file: null, html: '', published: true });
      await loadList(); setMonth(draft.month);
    } catch (error) {
      setFormError(error.message || '업로드에 실패했습니다. 파일은 유지됩니다.');
      if (error.code === 'conflict') { pending.current = null; await loadList(); }
    } finally { writeLock.current = false; setSaving(false); }
  };
  const remove = async () => {
    if (writeLock.current || !writer || !metadata || !window.confirm(`${reportMonthLabel(month)} 보고서를 목록에서 삭제하시겠습니까? 고객에게도 더 이상 표시되지 않습니다.`)) return;
    writeLock.current = true; setSaving(true);
    try {
      if (archivePending.current?.month !== month || archivePending.current?.rowVersion !== metadata.row_version) archivePending.current = { month, rowVersion: metadata.row_version, mutationId: crypto.randomUUID(), operation: 'ARCHIVE' };
      await source.saveMonthlyReport({ projectId: project.id, ...archivePending.current });
      archivePending.current = null;
      await loadList();
    } catch (error) { setList(current => ({ ...current, error })); }
    finally { writeLock.current = false; setSaving(false); }
  };

  return <div className="view-stack monthly-reports-view">
    {fullscreen && <div className="monthly-report-fullscreen-backdrop" aria-hidden="true" onClick={closeViewer} />}
    <header className="monthly-reports-heading">
      <div className="monthly-reports-title"><span>클라이언트 공유</span><h1>월별 마케팅 성과</h1></div>
      <div className="monthly-reports-toolbar">
        {list.items.length > 0 && <nav className="monthly-report-months" aria-label="마케팅 보고서 월 선택"><span className="monthly-report-month-label"><CalendarDays size={15} />보고 월</span><div className="monthly-report-month-options">{list.items.map(item => { const key = item.month.slice(0, 7); return <button type="button" key={key} data-report-month={key} aria-pressed={month === key} className={month === key ? 'is-active' : ''} onClick={() => setMonth(key)}><span>{reportMonthLabel(key)}</span>{!item.published && <small>초안</small>}{month === key && <Check size={14} />}</button>; })}{list.nextMonth && <button type="button" onClick={() => void loadList(list.nextMonth.slice(0, 7))}>이전 월 더보기</button>}</div></nav>}
        {writer && <button type="button" className="primary-button monthly-report-upload-trigger" onClick={() => openUpload()}><FileUp size={16} />HTML 보고서 업로드</button>}
      </div>
    </header>
    {list.error && <ErrorState error={list.error} onRetry={() => void loadList()} />}
    {list.loading ? <LoadingState /> : !list.items.length ? <EmptyState title="등록된 월별 보고서가 없습니다" description={writer ? 'HTML 보고서를 업로드하면 월별로 고객에게 공유할 수 있습니다.' : '운영팀이 공개한 보고서가 이곳에 표시됩니다.'} /> : <div className="monthly-reports-layout">
      <section ref={viewerRef} className={`monthly-report-viewer panel${fullscreen ? ' is-fullscreen' : ''}`} role={fullscreen ? 'dialog' : undefined} aria-modal={fullscreen || undefined} aria-label="마케팅 성과 보고서" tabIndex={fullscreen ? -1 : undefined}>
        <header><div><span>{reportMonthLabel(month)} · {metadata?.published ? '고객 공개' : '내부 초안'}</span><h2>{metadata?.title}</h2><small>업로드·수정 {timestamp(metadata?.updated_at)}</small></div><div className="monthly-report-actions">{writer && <><button type="button" disabled={saving} className="secondary-button" onClick={() => openUpload(true)}><FileUp size={14} />교체</button><button type="button" disabled={saving} className="icon-button" onClick={() => void remove()} aria-label="보고서 삭제"><Trash2 size={15} /></button></>}<button type="button" className="secondary-button" data-dialog-close={fullscreen || undefined} onClick={() => setFullscreen(current => !current)}>{fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}{fullscreen ? '닫기' : '전체화면'}</button></div></header>
        {report.loading ? <LoadingState label="보고서를 준비하고 있습니다." /> : report.error ? <ErrorState error={report.error} onRetry={() => setReportRevision(current => current + 1)} /> : report.item ? <iframe title={`${reportMonthLabel(month)} 마케팅 성과 보고서`} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={srcDoc} /> : <EmptyState title="보고서가 삭제되었거나 공개되지 않았습니다" />}
      </section>
    </div>}
    {upload && <div className="modal-backdrop monthly-report-upload-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeUpload(); }}><form ref={uploadRef} className="monthly-report-upload" role="dialog" aria-modal="true" aria-labelledby="report-upload-title" onSubmit={save}>
      <header><h2 id="report-upload-title">HTML 보고서 업로드</h2><button type="button" className="icon-button" data-dialog-close disabled={saving} onClick={closeUpload} aria-label="업로드 닫기"><X size={18} /></button></header>
      <p>{project.clientName || project.name} 프로젝트에 등록합니다. 같은 월의 보고서는 교체됩니다.</p>
      <label>보고 월<input type="month" min="2000-01" max="2100-12" value={draft.month} required disabled={saving} onChange={event => { pending.current = null; setDraft(current => ({ ...current, month: event.target.value })); }} /></label>
      <label>보고서 제목<input maxLength={160} value={draft.title} disabled={saving} placeholder="비워두면 기업명과 보고 월로 설정됩니다" onChange={event => { pending.current = null; setDraft(current => ({ ...current, title: event.target.value })); }} /></label>
      <label className="monthly-report-file"><FileUp size={24} /><strong>{draft.file?.name || 'HTML 파일 선택'}</strong><span>UTF-8 · 최대 3MB · 이미지가 포함된 단일 HTML</span><input type="file" accept=".html,.htm,text/html" aria-label="HTML 보고서 파일" disabled={saving} onChange={event => void pickFile(event.target.files?.[0])} />{reading && <small>파일 확인 중…</small>}</label>
      <label className="monthly-report-public"><input type="checkbox" checked={draft.published} disabled={saving} onChange={event => { pending.current = null; setDraft(current => ({ ...current, published: event.target.checked })); }} /><span>고객에게 공개<small>해제하면 내부 초안으로만 보입니다. 이 프로젝트의 고객 공유 권한이 있는 계정만 볼 수 있습니다.</small></span></label>
      <p className="monthly-report-file-note">보고서는 격리해서 표시합니다. 외부 이미지·데이터 요청은 제한되므로 이미지는 HTML 안에 포함해 주세요.</p>
      {formError && <p className="monthly-report-error" role="alert">{formError}</p>}
      <footer><button type="button" className="secondary-button" disabled={saving} onClick={closeUpload}>취소</button><button type="submit" className="primary-button" disabled={saving || reading || !draft.file || !draft.month}>{saving ? '업로드 중…' : draft.published ? '고객 공개로 업로드' : '내부 초안으로 업로드'}</button></footer>
    </form></div>}
  </div>;
}
