import { useWindowedRows } from "./useWindowedRows.js";
import { newestIssuesFirst } from "./issueOrder.js";
import { statusClass, formatSyncTime, EmptyState, LoadingState, ErrorState, FormSelect, trackerStatusOptions, trackerStatusLabels, trackerDate, localDateValue } from "./TaskUiPrimitives.jsx";
import { AlertCircle, ArrowRight, CalendarDays, Check, GripVertical, History, LoaderCircle, LockKeyhole, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { taskResponsibleOrgLabel, taskResponsibleOrgOptions, taskStatusMutationFields, taskUpdateInitialFields, taskUpdateSubmissionFields } from "./taskForm.js";

import { buildGanttAxis, ganttMonthClass, ganttTaskLabelWidth, groupGanttTasks, paintGanttRectangle, scheduleDateBounds, scheduleDateRange, scheduleDatesEqual, serializeScheduleDates, taskScheduleDates } from "./taskGantt.js";

import { buildTaskTimeline, filterTaskSchedule, groupTaskScheduleByMedia, reorderTaskSchedule, selectTaskRange, taskHiddenFromClient, taskScheduleCategory, taskScheduleMedia, taskScheduleMediaCode, taskScheduleStatusGroup, toggleScheduleStatusFilter } from "./taskTimeline.js";

import { isNewTask } from "./taskFreshness.js";

import IssueRequestCard from "./IssueRequestCard.jsx";

import { overdueTaskHoldRange } from "./taskScheduleStatus.js";

import { QuoteSummary } from "./QuoteSummary.jsx";

import { filterTaskActivities, groupTaskActivitiesByDate, readableTaskActivities, taskActivityDateKey, taskActivitySentence } from "./taskActivity.js";



const IssueRequestCreateModal = lazy(() => import("./IssueRequestCreateModal.jsx"));

const GANTT_DAY_WIDTH = 24;









function editableTaskStatusCode(value) {
  const code = String(value || "NOT_STARTED").toUpperCase();
  if (["DONE", "COMPLETED"].includes(code)) return "DONE";
  if (["ON_HOLD", "BLOCKED"].includes(code)) return "ON_HOLD";
  if (["IN_PROGRESS", "INTERNAL_REVIEW", "WAITING_CLIENT", "REVISION"].includes(code)) return "IN_PROGRESS";
  return "NOT_STARTED";
}


function TaskEditModal({ task, clientName, onClose, onUpdate }) {
  const [fields, setFields] = useState(() => taskUpdateInitialFields(task));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const setField = (name, value) => setFields((current) => ({ ...current, [name]: value }));

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    globalThis.addEventListener?.("keydown", closeOnEscape);
    return () => globalThis.removeEventListener?.("keydown", closeOnEscape);
  }, [onClose, saving]);

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await onUpdate(task, taskUpdateSubmissionFields(fields));
      onClose();
    } catch (saveError) {
      setError(saveError);
    } finally {
      setSaving(false);
    }
  };

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section className="create-modal task-edit-modal" role="dialog" aria-modal="true" aria-labelledby="task-edit-title">
      <header><div><p className="editorial-kicker">프로젝트 일정표</p><h2 id="task-edit-title">업무 수정</h2></div><button className="icon-button" type="button" onClick={onClose} disabled={saving} aria-label="닫기"><X size={18} /></button></header>
      <form onSubmit={submit}>
        <label className="create-field is-wide"><span>업무명</span><input autoFocus required maxLength={200} value={fields.title} disabled={saving} onChange={(event) => setField("title", event.target.value)} /></label>
        <div className="create-field is-wide task-edit-status"><span>상태</span><div className="tracker-status-actions">{trackerStatusOptions.map(([code, label]) => <button key={code} type="button" disabled={saving} className={fields.status_code === code ? "is-active" : ""} onClick={() => setField("status_code", code)}>{label}</button>)}</div></div>
        <label className="create-field"><span>시작일</span><input type="date" value={fields.planned_start_date} max={fields.due_date || undefined} disabled={saving} onChange={(event) => setField("planned_start_date", event.target.value)} /></label>
        <label className="create-field"><span>종료일</span><input type="date" value={fields.due_date} min={fields.planned_start_date || undefined} disabled={saving} onChange={(event) => setField("due_date", event.target.value)} /></label>
        <label className="create-field"><span>진행률 (%)</span><input type="number" min="0" max="100" value={fields.progress_percent} disabled={saving} onChange={(event) => setField("progress_percent", event.target.value)} /></label>
        <FormSelect label="우선순위" value={fields.priority_code} onChange={(value) => setField("priority_code", value)} options={[["LOW", "낮음"], ["NORMAL", "보통"], ["HIGH", "높음"], ["CRITICAL", "긴급"]]} />
        <FormSelect label="담당" value={fields.responsible_org_code} onChange={(value) => setField("responsible_org_code", value)} options={taskResponsibleOrgOptions(clientName)} />
        <label className="create-field is-wide"><span>세부내용</span><textarea rows="3" maxLength={10000} value={fields.description} disabled={saving} onChange={(event) => setField("description", event.target.value)} /></label>
        <label className="create-field is-wide"><span>완료링크</span><input type="url" pattern="https://.*" value={fields.completion_url} disabled={saving} onChange={(event) => setField("completion_url", event.target.value)} placeholder="https://" /></label>
        <label className="create-field is-wide"><span>비고</span><textarea rows="2" maxLength={10000} value={fields.remarks} disabled={saving} onChange={(event) => setField("remarks", event.target.value)} /></label>
        {error && <div className="form-error"><AlertCircle size={15} /><span>{error.message || "업무를 저장하지 못했습니다."}</span></div>}
        <footer><p>저장하면 Supabase 업무 원장과 업무 로그에 반영됩니다.</p><div><button className="secondary-button" type="button" onClick={onClose} disabled={saving}>취소</button><button className="primary-button" type="submit" disabled={saving || !fields.title.trim()}>{saving ? <><LoaderCircle size={15} className="spin" /> 저장 중</> : "변경 저장"}</button></div></footer>
      </form>
    </section>
  </div>;
}

function taskActivityValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "예" : "아니요";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

const taskActivityDateFilters = [
  ["ALL", "전체"],
  ["TODAY", "오늘"],
  ["YESTERDAY", "어제"],
  ["LAST_7_DAYS", "최근 7일"],
];

function taskActivityDateLabel(value) {
  if (value === "날짜 미상") return value;
  const today = taskActivityDateKey(new Date());
  const date = new Date(`${value}T00:00:00+09:00`);
  const label = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short" }).format(date);
  return value === today ? `오늘 · ${label}` : label;
}

function TaskActivityLog({ state, tasks, clientName, onRefresh, onLoadMore }) {
  const data = state?.data || null;
  const items = useMemo(() => readableTaskActivities(data?.items || [], tasks || []), [data?.items, tasks]);
  const [dateFilter, setDateFilter] = useState("ALL");
  const [ownerFilter, setOwnerFilter] = useState("ALL");
  const filteredItems = useMemo(() => filterTaskActivities(items, { dateFilter, ownerFilter }), [items, dateFilter, ownerFilter]);
  const groups = useMemo(() => groupTaskActivitiesByDate(filteredItems), [filteredItems]);
  const ownerOptions = useMemo(() => [["ALL", "전체"], ...taskResponsibleOrgOptions(clientName)], [clientName]);
  const loading = state?.status === "loading";
  const loadingMore = state?.loadingMore === true;

  return <section className="task-change-log is-embedded" aria-label="업무 로그" aria-busy={loading}>
    {loading && !data ? <LoadingState label="업무 로그를 불러오는 중입니다." /> : state?.status === "error" && !data ? <ErrorState error={state.error} onRetry={onRefresh} title="업무 로그를 불러오지 못했습니다." /> : <>
      {state?.status === "error" && data && <div className="task-change-log-warning" role="alert"><AlertCircle size={14} />{state.error?.message || "새로고침하지 못해 이전 로그를 표시합니다."}</div>}
      {items.length > 0 && <div className="task-activity-filters" aria-label="업무 로그 필터">
        <div className="task-activity-filter-group"><strong>일자별</strong><div>{taskActivityDateFilters.map(([value, label]) => <button type="button" key={value} className={dateFilter === value ? "is-active" : ""} aria-pressed={dateFilter === value} onClick={() => setDateFilter(value)}>{label}</button>)}</div></div>
        <div className="task-activity-filter-group"><strong>담당별</strong><div>{ownerOptions.map(([value, label]) => <button type="button" key={value} className={ownerFilter === value ? "is-active" : ""} aria-pressed={ownerFilter === value} onClick={() => setOwnerFilter(value)}>{label}</button>)}</div></div>
        <span>{filteredItems.length}건</span>
      </div>}
      {groups.length ? <div className="task-change-log-list">{groups.map((group) => <section className="task-change-log-day" key={group.date}><header><strong>{taskActivityDateLabel(group.date)}</strong><span>{group.items.length}건</span></header>{group.items.map((item) => <article key={item.id} className="task-change-log-row">
      <time dateTime={item.createdAt || undefined}>{formatSyncTime(item.createdAt)}</time>
      <div className="task-change-log-task"><strong>{item.taskTitle}</strong></div>
      <span className={`task-change-log-action is-${String(item.actionCode || "changed").toLowerCase()}`}>{item.action}</span>
      <div className="task-change-log-changes">{item.changes.length ? item.changes.map((change) => <div key={`${item.id}-${change.field}`}><strong>{change.label}</strong><span>{taskActivityValue(change.before)}</span><ArrowRight size={12} /><em>{taskActivityValue(change.after)}</em></div>) : <span className="task-change-log-no-detail">{taskActivitySentence(item)}</span>}</div>
      <div className="task-change-log-actor"><small>변경자</small><strong>{item.actor}</strong></div>
      </article>)}</section>)}</div> : <EmptyState title={items.length ? "조건에 맞는 업무 로그가 없습니다" : "업무 로그가 없습니다"} description={items.length ? "일자 또는 담당 필터를 변경해 주세요." : "웹에서 업무를 생성하거나 수정하면 확정된 이력이 표시됩니다."} />}
      {data?.nextCursor && <div className="task-activity-load-more"><button className="btn" type="button" disabled={loadingMore} onClick={() => onLoadMore?.(data.nextCursor)}>{loadingMore ? <LoaderCircle size={13} className="spin" /> : <History size={13} />}{loadingMore ? "이전 로그 불러오는 중" : "이전 로그 더 보기"}</button><small>로그는 삭제하지 않고 계속 누적 저장됩니다.</small></div>}
    </>}
  </section>;
}

function taskDurationDays(startValue, endValue) {
  const start = trackerDate(startValue);
  const end = trackerDate(endValue);
  if (!start || !end || end < start) return null;
  return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
}

function taskInlineDraft(task = {}, displayedStart, displayedEnd) {
  return {
    title: task.title || "",
    description: task.description || "",
    planned_start_date: displayedStart || task.plannedStartDate || "",
    due_date: displayedEnd || task.dueDate || "",
    progress_percent: task.progressPercent ?? 0,
    status_code: editableTaskStatusCode(task.statusCode),
    responsible_org_code: task.responsibleOrgCode || "POCKET",
    completion_url: task.completionUrl || "",
    remarks: task.remarks || "",
  };
}

function validInlineTaskUrl(value) {
  return !String(value || "").trim() || /^https?:\/\/[^\s]+$/i.test(String(value).trim());
}

function compactTaskDateLabel(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  return match ? `${Number(match[2])}.${Number(match[3])}` : "–";
}

function CompactTaskDateInput({ label, value, min, max, readOnly, disabled, onChange }) {
  const openPicker = (event) => {
    const input = event.currentTarget;
    if (readOnly || disabled || typeof input.showPicker !== "function") return;
    try { input.showPicker(); event.preventDefault(); } catch { /* Keep the native picker fallback. */ }
  };
  return <label className={`task-inline-date-compact${readOnly ? " is-readonly" : ""}`} title={value || label}>
    <span className="task-inline-date-display" aria-hidden="true">{compactTaskDateLabel(value)}</span>
    <CalendarDays size={11} aria-hidden="true" />
    <input className="task-inline-date" type="date" aria-label={label} value={value} min={min} max={max} readOnly={readOnly} disabled={disabled} onClick={openPicker} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openPicker(event); }} onChange={onChange} />
  </label>;
}

function TaskRowActions({ task, onEdit, onArchive, disabled = false, compact = false }) {
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!deleteArmed) return undefined;
    const timer = globalThis.setTimeout?.(() => setDeleteArmed(false), 5000);
    return () => globalThis.clearTimeout?.(timer);
  }, [deleteArmed]);

  const requestArchive = async () => {
    if (disabled || deleting) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      setError("");
      return;
    }
    setDeleting(true);
    setError("");
    try {
      await onArchive(task);
    } catch (archiveError) {
      setDeleteArmed(false);
      setError(archiveError?.message || "업무를 삭제하지 못했습니다.");
    } finally {
      setDeleting(false);
    }
  };

  return <div className={`task-row-actions${compact ? " is-compact" : ""}${deleteArmed ? " is-delete-armed" : ""}`}>
    <button type="button" className="task-action-edit" disabled={disabled || deleting} onClick={() => onEdit(task.id)} aria-label={`${task.title} 수정`} title="업무 수정"><Pencil size={13} /></button>
    <button type="button" className="task-action-delete" disabled={disabled || deleting} onClick={() => void requestArchive()} aria-label={deleteArmed ? `${task.title} 삭제 확인` : `${task.title} 삭제`} title={deleteArmed ? "한 번 더 눌러 삭제" : "업무 삭제"}>{deleting ? <LoaderCircle size={13} className="spin" /> : deleteArmed ? <span>삭제?</span> : <Trash2 size={13} />}</button>
    {error && <small className="task-row-action-error" role="alert" title={error}>{error}</small>}
  </div>;
}

function TaskScheduleInlineRow({ task, project, canWrite, onUpdate, onEdit, onArchive, displayedStart, displayedEnd, newTask, rowClass, mediaColor, mediaGroupStart, selected, onSelect, reorderEnabled, dragging, dropPosition, onDragStart, onDragEnd, onDragOver, onDrop }) {
  const [draft, setDraft] = useState(() => taskInlineDraft(task, displayedStart, displayedEnd));
  const [savingField, setSavingField] = useState("");
  const [saveError, setSaveError] = useState("");
  const taskRef = useRef(task);

  useEffect(() => {
    taskRef.current = task;
    if (!savingField) setDraft(taskInlineDraft(task, displayedStart, displayedEnd));
  }, [task, displayedStart, displayedEnd, savingField]);

  const setField = (field, value) => {
    setSaveError("");
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const commitField = async (field, rawValue) => {
    if (!canWrite || !onUpdate || savingField) return;
    const baseTask = taskRef.current;
    const baseDraft = taskInlineDraft(baseTask, baseTask.plannedStartDate, baseTask.dueDate);
    let value = rawValue;
    if (["title", "completion_url"].includes(field)) value = String(rawValue || "").trim();
    if (field === "progress_percent") {
      value = Number(rawValue);
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        setSaveError("진행률은 0~100 사이로 입력해 주세요.");
        setDraft((current) => ({ ...current, progress_percent: baseDraft.progress_percent }));
        return;
      }
    }
    if (field === "title" && !value) {
      setSaveError("업무명은 비워둘 수 없습니다.");
      setDraft((current) => ({ ...current, title: baseDraft.title }));
      return;
    }
    if (field === "completion_url" && !validInlineTaskUrl(value)) {
      setSaveError("완료링크는 http:// 또는 https:// 주소로 입력해 주세요.");
      return;
    }

    const dateRangeField = field === "date_range";
    let nextDraft = dateRangeField ? { ...draft } : { ...draft, [field]: value };
    let fields = dateRangeField ? {} : { [field]: value };
    if (field === "status_code") {
      fields = taskStatusMutationFields(value, baseTask);
      nextDraft = { ...nextDraft, ...fields };
    }
    if (field === "progress_percent" && value < 100 && ["DONE", "COMPLETED"].includes(baseTask.statusCode)) {
      fields.status_code = "IN_PROGRESS";
      nextDraft.status_code = "IN_PROGRESS";
    }
    if (dateRangeField || field === "planned_start_date" || field === "due_date") {
      const start = String(nextDraft.planned_start_date || "");
      const end = String(nextDraft.due_date || "");
      if (start && end && end < start) {
        setSaveError("종료일은 시작일보다 빠를 수 없습니다.");
        return;
      }
      fields = {
        planned_start_date: start,
        due_date: end,
        schedule_dates_json: start && end ? serializeScheduleDates(scheduleDateRange(start, end)) : null,
      };
    }
    const unchanged = Object.entries(fields).every(([key, fieldValue]) => {
      if (key === "schedule_dates_json") return true;
      return String(baseDraft[key] ?? "") === String(fieldValue ?? "");
    });
    if (unchanged) return;

    setDraft(nextDraft);
    setSavingField(field);
    setSaveError("");
    try {
      const savedTask = await onUpdate(baseTask, fields);
      if (savedTask) {
        taskRef.current = savedTask;
        setDraft(taskInlineDraft(savedTask, savedTask.plannedStartDate, savedTask.dueDate));
      }
    } catch (error) {
      setDraft(taskInlineDraft(baseTask, baseTask.plannedStartDate, baseTask.dueDate));
      setSaveError(error?.code === "conflict" ? "다른 사용자의 변경사항을 먼저 다시 불러와 주세요." : error?.message || "저장하지 못했습니다.");
    } finally {
      setSavingField("");
    }
  };

  const commitOnEnter = (event, field) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDraft(taskInlineDraft(taskRef.current, taskRef.current.plannedStartDate, taskRef.current.dueDate));
      event.currentTarget.blur();
    }
  };

  const duration = taskDurationDays(draft.planned_start_date, draft.due_date);
  const statusLabel = trackerStatusLabels[draft.status_code] || draft.status_code;
  const media = taskScheduleMedia(task);
  const progress = Math.max(0, Math.min(100, Number(draft.progress_percent) || 0));
  const disabled = !canWrite || Boolean(savingField);
  const customerHidden = taskHiddenFromClient(task);

  return <tr data-window-id={task.id} className={`task-schedule-row reference-task-row ${rowClass}${mediaGroupStart ? " is-media-group-start" : ""}${newTask ? " is-new-task" : ""}${savingField ? " is-saving" : ""}${saveError ? " has-save-error" : ""}${selected ? " is-selected" : ""}${dragging ? " is-dragging" : ""}${dropPosition ? ` is-drop-${dropPosition}` : ""}`} style={{ "--media-color": mediaColor }} onDragOver={(event) => onDragOver?.(event, task.id)} onDrop={(event) => { if (!reorderEnabled) return; event.preventDefault(); onDrop?.(task.id); }}>
    {canWrite && <td className="reference-task-select"><div className="reference-task-cell"><input type="checkbox" checked={selected} onChange={(event) => onSelect?.(task.id, event.target.checked, { shiftKey: event.nativeEvent?.shiftKey || event.shiftKey })} aria-label={`${task.title} 선택`} /></div></td>}
    <td className="reference-task-media" aria-label={media}><div className="reference-task-cell"><span><i aria-hidden="true" />{media}</span></div></td>
    <td className="reference-task-workstream"><div className="reference-task-cell">{taskScheduleCategory(task)}</div></td>
    <td className="reference-task-name"><div className="reference-task-cell">{canWrite && <span className="task-reorder-handle" draggable={reorderEnabled} onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(task.id)); onDragStart?.(task.id); }} onDragEnd={onDragEnd} aria-label={`${task.title} 순서 이동`} title={reorderEnabled ? "끌어서 업무 순서 이동" : "필터를 해제하면 순서를 이동할 수 있습니다"}><GripVertical size={14} /><small>이동</small></span>}<input className="task-inline-input task-name" aria-label={`${task.title} 업무명`} maxLength={500} readOnly={!canWrite} disabled={Boolean(savingField)} value={draft.title} onChange={(event) => setField("title", event.target.value)} onBlur={(event) => void commitField("title", event.currentTarget.value)} onKeyDown={(event) => commitOnEnter(event, "title")} />{newTask && <em className="task-new-badge">신규</em>}{customerHidden && <em className="task-client-hidden-badge" title="고객사 계정에는 표시되지 않습니다"><LockKeyhole size={9} />고객 숨김</em>}{saveError && <small className="task-inline-error" role="alert">{saveError}</small>}</div></td>
    <td className="reference-task-detail"><div className="reference-task-cell"><textarea className="task-inline-textarea" aria-label={`${task.title} 세부내용`} rows="1" maxLength={20000} readOnly={!canWrite} disabled={Boolean(savingField)} value={draft.description} placeholder={canWrite ? "세부내용" : ""} onChange={(event) => setField("description", event.target.value)} onBlur={(event) => void commitField("description", event.currentTarget.value)} onKeyDown={(event) => commitOnEnter(event, "description")} /></div></td>
    <td className="reference-task-dates"><div className="reference-task-cell task-inline-date-range" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) void commitField("date_range"); }}><CompactTaskDateInput label={`${task.title} 시작일`} readOnly={!canWrite} disabled={disabled} value={draft.planned_start_date} max={draft.due_date || undefined} onChange={(event) => setField("planned_start_date", event.target.value)} /><ArrowRight size={10} aria-hidden="true" /><CompactTaskDateInput label={`${task.title} 종료일`} readOnly={!canWrite} disabled={disabled} value={draft.due_date} min={draft.planned_start_date || undefined} onChange={(event) => setField("due_date", event.target.value)} /></div></td>
    <td className="reference-task-duration"><div className="reference-task-cell">{duration === null ? "–" : `${duration}일`}</div></td>
    <td className="reference-task-progress"><div className="reference-task-cell"><span className="task-inline-progress"><span><i style={{ width: `${progress}%` }} /></span><input type="number" min="0" max="100" aria-label={`${task.title} 진행률`} readOnly={!canWrite} disabled={disabled} value={draft.progress_percent} onChange={(event) => setField("progress_percent", event.target.value)} onBlur={(event) => void commitField("progress_percent", event.currentTarget.value)} onKeyDown={(event) => commitOnEnter(event, "progress_percent")} /><em>%</em></span></div></td>
    <td className="reference-task-status"><div className="reference-task-cell"><select className={`task-inline-select task-inline-status ${statusClass[statusLabel] || "status status-muted"}`} disabled={disabled} data-status-code={draft.status_code} aria-label={`${task.title} 상태`} value={draft.status_code} onChange={(event) => { const next = event.target.value; setField("status_code", next); void commitField("status_code", next); }}>{trackerStatusOptions.map(([code, label]) => <option value={code} key={code}>{label}</option>)}</select></div></td>
    <td className="reference-task-owner"><div className="reference-task-cell"><select className={`task-inline-select task-inline-owner is-${String(draft.responsible_org_code || "POCKET").toLowerCase()}`} disabled={disabled} aria-label={`${task.title} 담당`} value={draft.responsible_org_code} onChange={(event) => { const next = event.target.value; setField("responsible_org_code", next); void commitField("responsible_org_code", next); }}>{taskResponsibleOrgOptions(project.clientName).map(([code, label]) => <option value={code} key={code}>{label}</option>)}</select></div></td>
    <td className="reference-task-link"><div className="reference-task-cell"><span className="task-inline-link">{validInlineTaskUrl(draft.completion_url) && draft.completion_url && <a href={draft.completion_url} target="_blank" rel="noreferrer" aria-label={`${task.title} 완료링크 열기`}>열기 ↗</a>}<input className="task-inline-input" type="text" inputMode="url" aria-label={`${task.title} 완료링크`} maxLength={2048} readOnly={!canWrite} disabled={Boolean(savingField)} value={draft.completion_url} placeholder={canWrite ? "https://" : ""} onChange={(event) => setField("completion_url", event.target.value)} onBlur={(event) => void commitField("completion_url", event.currentTarget.value)} onKeyDown={(event) => commitOnEnter(event, "completion_url")} /></span></div></td>
    <td className="reference-task-note"><div className="reference-task-cell"><textarea className="task-inline-textarea" aria-label={`${task.title} 비고`} rows="1" maxLength={10000} readOnly={!canWrite} disabled={Boolean(savingField)} value={draft.remarks} placeholder={canWrite ? "비고" : ""} onChange={(event) => setField("remarks", event.target.value)} onBlur={(event) => void commitField("remarks", event.currentTarget.value)} onKeyDown={(event) => commitOnEnter(event, "remarks")} /></div></td>
    {canWrite && <td className="reference-task-actions"><TaskRowActions task={task} onEdit={onEdit} onArchive={onArchive} disabled={Boolean(savingField)} /></td>}
  </tr>;
}

function TaskScheduleInlineTable({ tasks, project, canWrite, onUpdate, onEdit, onArchive, ganttDrafts, freshnessNow, scheduleClass, mediaColor, selectedTaskIds, onSelectTask, onSelectAll, reorderEnabled, draggingTaskIds, dropIndicator, onDragStart, onDragEnd, onDragOverTask, onDropTask }) {
  const scrollRef = useRef(null);
  const windowed = useWindowedRows(tasks, scrollRef, { disabled: Boolean(draggingTaskIds?.length) });
  const columnWidths = [88, 64, null, 200, 126, 44, 92, 54, 54, 105, 135];
  const allSelected = Boolean(canWrite && tasks.length && tasks.every((task) => selectedTaskIds?.has(task.id)));
  let previousMedia = "";
  const bodyRows = [];
  tasks.forEach((task, index) => {
    const media = taskScheduleMedia(task);
    const mediaKey = media.replace(/\s+/g, " ").trim().toLocaleUpperCase("ko");
    const mediaGroupStart = !previousMedia || mediaKey !== previousMedia;
    previousMedia = mediaKey;
    if (index < windowed.start || index >= windowed.end) return;
    const scheduleDates = ganttDrafts?.get(task.id) || taskScheduleDates(task);
    const bounds = scheduleDateBounds(scheduleDates);
    bodyRows.push(<TaskScheduleInlineRow key={task.id} task={task} project={project} canWrite={canWrite} onUpdate={onUpdate} onEdit={onEdit} onArchive={onArchive} displayedStart={bounds.start || task.plannedStartDate || ""} displayedEnd={bounds.end || task.dueDate || ""} newTask={isNewTask(task, freshnessNow)} rowClass={scheduleClass(task)} mediaColor={mediaColor(media)} mediaGroupStart={mediaGroupStart} selected={selectedTaskIds?.has(task.id)} onSelect={onSelectTask} reorderEnabled={reorderEnabled} dragging={draggingTaskIds?.includes(task.id)} dropPosition={dropIndicator?.taskId === task.id ? dropIndicator.position : ""} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragOver={onDragOverTask} onDrop={onDropTask} />);
  });
  return <div ref={scrollRef} className="task-schedule-matrix-scroll reference-task-scroll"><table className={`task-schedule-matrix is-detailed reference-task-table${canWrite ? " has-row-selection" : ""}`} style={{ "--schedule-min-width": canWrite ? "1336px" : "1252px" }}><colgroup>{canWrite && <col style={{ width: 28 }} />}{columnWidths.map((width, index) => <col key={index} style={width ? { width } : undefined} />)}{canWrite && <col style={{ width: 56 }} />}</colgroup><thead><tr>{canWrite && <th className="reference-task-select"><input type="checkbox" checked={allSelected} onChange={(event) => onSelectAll?.(event.target.checked)} aria-label="표시된 업무 전체 선택" /></th>}<th>매체</th><th>업무분야</th><th>업무</th><th>세부내용</th><th>일정</th><th>기간</th><th>진행률</th><th>상태</th><th>담당</th><th>완료링크</th><th>비고</th>{canWrite && <th>관리</th>}</tr></thead><tbody>{windowed.before > 0 && <tr aria-hidden="true" className="virtual-spacer"><td colSpan={canWrite ? 13 : 11} style={{ height: windowed.before, padding: 0, border: 0 }} /></tr>}{bodyRows}{windowed.after > 0 && <tr aria-hidden="true" className="virtual-spacer"><td colSpan={canWrite ? 13 : 11} style={{ height: windowed.after, padding: 0, border: 0 }} /></tr>}</tbody></table></div>;
}

const scheduleStatusFilters = [["ALL", "전체"], ["TODO", "미착수"], ["ACTIVE", "진행"], ["DONE", "완료"], ["HOLD", "보류"]];

const scheduleCategoryFilters = [["ALL", "전체"], ["마케팅", "마케팅"], ["디자인", "디자인"], ["영상", "영상"]];

const scheduleWeekFilters = [["ALL", "전체"], ["TODAY", "오늘"], ["LAST_WEEK", "지난주"], ["THIS_WEEK", "이번주"], ["NEXT_WEEK", "다음주"], ["THIS_MONTH", "이번달"]];

function ScheduleFilterButtons({ label, value, options, onChange }) {
  return <div className="task-schedule-filter-group"><span>{label}</span><div role="group" aria-label={label}>{options.map(([id, text]) => <button type="button" key={id} className={value === id ? "is-active" : ""} aria-pressed={value === id} onClick={() => onChange(id)}>{text}</button>)}</div></div>;
}

function TaskScheduleFilters({ groups, count, total, onReset }) {
  const applied = groups.filter(group => group.value !== "ALL");
  return <section className="schedule-filter-panel" aria-label="일정표 업무 필터">
    <header className="schedule-filter-heading"><div><strong>업무 필터</strong><small>여러 조건을 함께 선택할 수 있습니다</small></div><span className="schedule-filter-count" aria-live="polite"><strong>{count}</strong> / {total}건</span></header>
    <div className="schedule-filter-rows">{groups.map(group => <div key={group.id} id={`schedule-filter-${group.id}`}><ScheduleFilterButtons label={group.label} value={group.value} options={group.options} onChange={group.onChange} /></div>)}</div>
    {applied.length > 0 && <div className="schedule-applied-filters"><span>적용 조건</span>{applied.map(group => <button type="button" key={group.id} aria-label={`${group.label} 필터 해제`} onClick={() => group.onChange("ALL")}>{group.options.find(([id]) => id === group.value)?.[1] || group.value}<X size={11} /></button>)}<button type="button" className="schedule-filter-reset" onClick={onReset}>전체 해제</button></div>}
  </section>;
}

function TaskWorkspaceTabs({ activeView, onChange, canViewActivity }) {
  return <div className="campaign-schedule-view-tabs seg task-workspace-tabs" role="tablist" aria-label="업무 화면 전환">
    <button type="button" role="tab" aria-selected={activeView === "table"} className={activeView === "table" ? "is-active" : ""} onClick={() => onChange("table")}><span>일정표</span>{activeView === "table" && <Check className="task-workspace-tab-check" size={14} strokeWidth={3} aria-hidden="true" />}</button>
    <button type="button" role="tab" aria-selected={activeView === "gantt"} className={activeView === "gantt" ? "is-active" : ""} onClick={() => onChange("gantt")}><span>간트</span>{activeView === "gantt" && <Check className="task-workspace-tab-check" size={14} strokeWidth={3} aria-hidden="true" />}</button>
    {canViewActivity && <button type="button" role="tab" aria-selected={activeView === "activity"} className={activeView === "activity" ? "is-active" : ""} onClick={() => onChange("activity")}><span>업무 로그</span>{activeView === "activity" && <Check className="task-workspace-tab-check" size={14} strokeWidth={3} aria-hidden="true" />}</button>}
  </div>;
}

const issueStatusOrder = ["NOT_STARTED", "IN_PROGRESS", "DONE", "ON_HOLD"];

const issueStatusLabels = { NOT_STARTED: "예정", IN_PROGRESS: "진행중", DONE: "완료", ON_HOLD: "보류" };

function ProjectIssueRow({ issue, index, canWrite, onUpdate, onArchive }) {
  const [draft, setDraft] = useState(() => ({
    issue_date: issue.date || localDateValue(),
    due_date: issue.dueDate || "",
    kind_text: issue.kind || "",
    related_task_text: issue.relatedTask || "",
    body_text: issue.body || "",
    owner_text: issue.owner || "",
    status_code: issue.statusCode || "IN_PROGRESS",
    completion_url: issue.completionUrl || "",
    remarks: issue.remarks || "",
  }));
  const [savingField, setSavingField] = useState("");
  const [saveError, setSaveError] = useState("");
  const [deleteArmed, setDeleteArmed] = useState(false);
  useEffect(() => {
    setDraft({
      issue_date: issue.date || localDateValue(),
      due_date: issue.dueDate || "",
      kind_text: issue.kind || "",
      related_task_text: issue.relatedTask || "",
      body_text: issue.body || "",
      owner_text: issue.owner || "",
      status_code: issue.statusCode || "IN_PROGRESS",
      completion_url: issue.completionUrl || "",
      remarks: issue.remarks || "",
    });
  }, [issue.id, issue.rowVersion]);
  const setField = (field, value) => {
    setSaveError("");
    setDraft((current) => ({ ...current, [field]: value }));
  };
  const persistedValue = (field) => ({
    issue_date: issue.date || "",
    due_date: issue.dueDate || "",
    kind_text: issue.kind || "",
    related_task_text: issue.relatedTask || "",
    body_text: issue.body || "",
    owner_text: issue.owner || "",
    status_code: issue.statusCode || "IN_PROGRESS",
    completion_url: issue.completionUrl || "",
    remarks: issue.remarks || "",
  }[field]);
  const commitField = async (field, rawValue) => {
    if (!canWrite || savingField) return;
    const value = typeof rawValue === "string" ? rawValue.trim() : rawValue;
    if (field === "issue_date" && !value) {
      setField(field, persistedValue(field));
      setSaveError("등록일을 입력해 주세요.");
      return;
    }
    if (field === "completion_url" && value && !validInlineTaskUrl(value)) {
      setSaveError("완료링크는 http:// 또는 https:// 주소로 입력해 주세요.");
      return;
    }
    if (String(persistedValue(field)) === String(value)) return;
    setSavingField(field);
    setSaveError("");
    try {
      await onUpdate(issue, { [field]: value });
    } catch (error) {
      setField(field, persistedValue(field));
      setSaveError(error?.message || "변경사항을 저장하지 못했습니다.");
    } finally {
      setSavingField("");
    }
  };
  const commitOnEnter = (event, field) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    event.currentTarget.blur();
  };
  const cycleStatus = () => {
    if (!canWrite || savingField) return;
    const currentIndex = Math.max(0, issueStatusOrder.indexOf(draft.status_code));
    const next = issueStatusOrder[(currentIndex + 1) % issueStatusOrder.length];
    setField("status_code", next);
    void commitField("status_code", next);
  };
  const archive = async () => {
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    setSavingField("archive");
    setSaveError("");
    try {
      await onArchive(issue);
    } catch (error) {
      setDeleteArmed(false);
      setSaveError(error?.message || "행을 삭제하지 못했습니다.");
      setSavingField("");
    }
  };
  const disabled = !canWrite || Boolean(savingField);
  return <tr className={savingField ? "is-saving" : ""}>
    <td className="project-issue-number">{index + 1}</td>
    <td><div className="project-issue-date-stack"><label className="project-issue-date-field"><span>등록일</span><input type="date" aria-label={`${index + 1}번 이슈 등록일`} disabled={disabled} value={draft.issue_date} onChange={(event) => setField("issue_date", event.target.value)} onBlur={(event) => void commitField("issue_date", event.currentTarget.value)} /></label><label className="project-issue-date-field is-deadline"><span>컨펌 마감일</span><input type="date" aria-label={`${index + 1}번 이슈 컨펌 마감일`} disabled={disabled} value={draft.due_date} onChange={(event) => setField("due_date", event.target.value)} onBlur={(event) => void commitField("due_date", event.currentTarget.value)} /></label></div></td>
    <td><input type="text" aria-label={`${index + 1}번 이슈 구분`} maxLength={100} readOnly={!canWrite} disabled={Boolean(savingField)} value={draft.kind_text} placeholder={canWrite ? "추가업무" : ""} onChange={(event) => setField("kind_text", event.target.value)} onBlur={(event) => void commitField("kind_text", event.currentTarget.value)} onKeyDown={(event) => commitOnEnter(event, "kind_text")} /></td>
    <td><input type="text" aria-label={`${index + 1}번 관련 업무`} maxLength={500} readOnly={!canWrite} disabled={Boolean(savingField)} value={draft.related_task_text} placeholder={canWrite ? "관련 업무" : ""} onChange={(event) => setField("related_task_text", event.target.value)} onBlur={(event) => void commitField("related_task_text", event.currentTarget.value)} onKeyDown={(event) => commitOnEnter(event, "related_task_text")} /></td>
    <td><textarea rows="1" aria-label={`${index + 1}번 이슈 내용`} maxLength={20000} readOnly={!canWrite} disabled={Boolean(savingField)} value={draft.body_text} placeholder={canWrite ? "내용을 입력하세요" : ""} onChange={(event) => setField("body_text", event.target.value)} onBlur={(event) => void commitField("body_text", event.currentTarget.value)} onKeyDown={(event) => commitOnEnter(event, "body_text")} /></td>
    <td><input type="text" aria-label={`${index + 1}번 이슈 담당자`} maxLength={100} readOnly={!canWrite} disabled={Boolean(savingField)} value={draft.owner_text} placeholder={canWrite ? "담당자" : ""} onChange={(event) => setField("owner_text", event.target.value)} onBlur={(event) => void commitField("owner_text", event.currentTarget.value)} onKeyDown={(event) => commitOnEnter(event, "owner_text")} /></td>
    <td><button type="button" className={`project-issue-status is-${draft.status_code.toLowerCase()}`} disabled={disabled} title="눌러서 예정 → 진행중 → 완료 → 보류 순으로 변경" onClick={cycleStatus}>{savingField === "status_code" ? <LoaderCircle size={12} className="spin" /> : issueStatusLabels[draft.status_code] || draft.status_code}</button></td>
    <td><div className="project-issue-link">{validInlineTaskUrl(draft.completion_url) && <a href={draft.completion_url} target="_blank" rel="noreferrer" aria-label={`${index + 1}번 완료링크 열기`}>열기 ↗</a>}<input type="text" inputMode="url" aria-label={`${index + 1}번 완료링크`} maxLength={2048} readOnly={!canWrite} disabled={Boolean(savingField)} value={draft.completion_url} placeholder={canWrite ? "https://" : ""} onChange={(event) => setField("completion_url", event.target.value)} onBlur={(event) => void commitField("completion_url", event.currentTarget.value)} onKeyDown={(event) => commitOnEnter(event, "completion_url")} /></div></td>
    <td><textarea rows="1" aria-label={`${index + 1}번 이슈 비고`} maxLength={10000} readOnly={!canWrite} disabled={Boolean(savingField)} value={draft.remarks} placeholder={canWrite ? "비고" : ""} onChange={(event) => setField("remarks", event.target.value)} onBlur={(event) => void commitField("remarks", event.currentTarget.value)} onKeyDown={(event) => commitOnEnter(event, "remarks")} />{saveError && <small role="alert">{saveError}</small>}</td>
    {canWrite && <td className="project-issue-action"><button type="button" className={deleteArmed ? "is-armed" : ""} disabled={Boolean(savingField)} onClick={archive} aria-label={`${index + 1}번 이슈 삭제`}>{savingField === "archive" ? <LoaderCircle size={13} className="spin" /> : deleteArmed ? "삭제?" : "×"}</button></td>}
  </tr>;
}

function ProjectIssuePanel({ issues, project, canWrite, actorName, onCreate, onUpdate, onArchive }) {
  const [composeOpen, setComposeOpen] = useState(false);
  const [issueFilter, setIssueFilter] = useState("open");
  useEffect(() => { setIssueFilter("open"); setComposeOpen(false); }, [project?.id]);
  const isDone = (issue) => ["DONE", "CLOSED", "COMPLETED"].includes(issue.statusCode);
  const doneCount = issues.filter(isDone).length;
  const visibleIssues = newestIssuesFirst(issues.filter((issue) => issueFilter === "done" ? isDone(issue) : !isDone(issue)));
  const owners = [...new Set([project?.clientName || "고객사", "포켓컴퍼니", "NS"])];
  return <section className="panel project-issue-panel" aria-label="확인 요청">
    <header className="panel-head reference-panel-head"><div><h2>확인 요청</h2><span className="hint">요청을 열지 않고 답변·마감일·확인 상태를 바로 처리합니다</span></div></header>
    <nav className="project-issue-status-tabs" aria-label="확인 요청 상태"><button type="button" aria-pressed={issueFilter === "open"} onClick={() => setIssueFilter("open")}>확인요청 <b>{issues.length - doneCount}</b></button><button type="button" aria-pressed={issueFilter === "done"} onClick={() => setIssueFilter("done")}>확인완료 <b>{doneCount}</b></button></nav>
    {visibleIssues.length ? <div className="project-issue-card-list">{visibleIssues.map((issue) => <IssueRequestCard key={issue.id} issue={issue} canWrite={canWrite} actorName={actorName} onUpdate={onUpdate} onArchive={onArchive} />)}</div> : <div className="project-issue-card-empty">{issueFilter === "done" ? "완료된 확인 요청이 없습니다." : "대기 중인 확인 요청이 없습니다."}</div>}
    {canWrite && <footer className="project-issue-footer"><button type="button" className="project-issue-add" onClick={() => setComposeOpen(true)}><Plus size={14} />확인 요청 추가</button></footer>}
    {composeOpen && <Suspense fallback={<LoadingState label="확인요청 작성 화면을 여는 중입니다." />}><IssueRequestCreateModal projects={[project]} initialProjectId={project?.id} owners={owners} actorName={actorName} onCreate={onCreate} onClose={() => setComposeOpen(false)} /></Suspense>}
  </section>;
}

function TaskScheduleTimeline({ tasks, issues, project, query, canWrite, canWriteIssues, actorName, canEditProject, canManageVisibility = false, onUpdate, onArchive, onBatchUpdate, onProjectUpdate, onCreate, onIssueCreate, onIssueUpdate, onIssueArchive, displayMode, onViewChange, canViewActivity, activityState, onLoadActivity, summaryOnly = false, showOwners = true }) {
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [scheduleFilter, setScheduleFilter] = useState("ALL");
  const [mediaFilter, setMediaFilter] = useState("ALL");
  const [ownerFilter, setOwnerFilter] = useState("ALL");
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState(() => new Set());
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkOwner, setBulkOwner] = useState("");
  const [bulkVisibility, setBulkVisibility] = useState("");
  const [bulkSave, setBulkSave] = useState({ status: "idle", error: "" });
  const [bulkDeleteArmed, setBulkDeleteArmed] = useState(false);
  const [draggingTaskId, setDraggingTaskId] = useState(null);
  const [draggingTaskIds, setDraggingTaskIds] = useState([]);
  const [taskDropIndicator, setTaskDropIndicator] = useState(null);
  const [startDateDraft, setStartDateDraft] = useState(project.startDate || "");
  const [startDateSaving, setStartDateSaving] = useState(false);
  const [startDateError, setStartDateError] = useState("");
  const [ganttSave, setGanttSave] = useState({ status: "idle", saved: 0, total: 0, error: "" });
  const [ganttDrafts, setGanttDrafts] = useState(null);
  const [freshnessNow, setFreshnessNow] = useState(() => Date.now());
  const activityMode = displayMode === "activity";
  const matrixRef = useRef(null);
  const ganttScrollRef = useRef(null);
  const schedulePanelRef = useRef(null);
  const [ganttViewportWidth, setGanttViewportWidth] = useState(0);
  useEffect(() => {
    const panel = schedulePanelRef.current;
    if (!panel) return;
    const measure = () => setGanttViewportWidth(panel.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);
  const paintRef = useRef(null);
  const ganttTasksRef = useRef([]);
  const daysRef = useRef([]);
  const selectionAnchorRef = useRef(null);
  const dragAutoScrollRef = useRef({ frame: null, container: null, speed: 0 });
  const draggingTaskIdsRef = useRef([]);
  const taskDropIndicatorRef = useRef(null);
  const ganttHoverRef = useRef({ rowIndex: null, dayIndex: null });
  useEffect(() => {
    setStatusFilter("ALL");
    setCategoryFilter("ALL");
    setScheduleFilter("ALL");
    setMediaFilter("ALL");
    setOwnerFilter("ALL");
    setEditingTaskId(null);
    setSelectedTaskIds(new Set());
    setBulkStatus("");
    setBulkOwner("");
    setBulkVisibility("");
    setBulkSave({ status: "idle", error: "" });
    setBulkDeleteArmed(false);
    setDraggingTaskId(null);
    setDraggingTaskIds([]);
    setTaskDropIndicator(null);
    draggingTaskIdsRef.current = [];
    taskDropIndicatorRef.current = null;
    setGanttSave({ status: "idle", saved: 0, total: 0, error: "" });
    setGanttDrafts(null);
    paintRef.current = null;
    selectionAnchorRef.current = null;
  }, [project.id]);
  useEffect(() => {
    setFreshnessNow(Date.now());
    const timer = globalThis.setInterval?.(() => setFreshnessNow(Date.now()), 60 * 1000);
    return () => globalThis.clearInterval?.(timer);
  }, [project.id]);
  useEffect(() => {
    setStartDateDraft(project.startDate || "");
    setStartDateError("");
  }, [project.id, project.startDate]);
  const searchNeedle = String(query || "").trim().toLowerCase();
  const mediaOptions = useMemo(() => [["ALL", "전체"], ...[...new Set(tasks.map(taskScheduleMedia))].map(media => [media, media])], [tasks]);
  const ownerOptions = [["ALL", "전체"], ["POCKET", "포켓 업무"], ["NS", "NS 업무"]];
  const resetScheduleFilters = () => {
    setStatusFilter("ALL"); setCategoryFilter("ALL"); setScheduleFilter("ALL"); setMediaFilter("ALL"); setOwnerFilter("ALL");
  };
  const ganttVisibleTasks = useMemo(() => filterTaskSchedule(tasks, {
    status: statusFilter,
    category: categoryFilter,
    schedule: scheduleFilter,
    media: mediaFilter,
    owner: canWrite ? ownerFilter : "ALL",
  }).filter((task) => !searchNeedle || `${task.title} ${task.description || ""} ${task.parent || ""} ${taskScheduleCategory(task)}`.toLowerCase().includes(searchNeedle)), [tasks, statusFilter, categoryFilter, scheduleFilter, mediaFilter, ownerFilter, canWrite, searchNeedle]);
  const filteredTasks = useMemo(() => groupTaskScheduleByMedia(ganttVisibleTasks), [ganttVisibleTasks]);
  const ganttLabelWidth = useMemo(() => ganttTaskLabelWidth(filteredTasks, { canWrite, showOwners }), [filteredTasks, canWrite, showOwners]);
  const reorderEnabled = canWrite && statusFilter === "ALL" && categoryFilter === "ALL" && scheduleFilter === "ALL" && mediaFilter === "ALL" && ownerFilter === "ALL" && !searchNeedle;
  const statusSummaryTasks = useMemo(() => filterTaskSchedule(tasks, {
    status: "ALL",
    category: categoryFilter,
    schedule: scheduleFilter,
    media: mediaFilter,
    owner: canWrite ? ownerFilter : "ALL",
  }), [tasks, categoryFilter, scheduleFilter, mediaFilter, ownerFilter, canWrite]);
  const timeline = useMemo(
    () => buildTaskTimeline(filteredTasks, project),
    [filteredTasks, project.startDate, project.endDate],
  );
  const summary = useMemo(() => {
    const countable = statusSummaryTasks.filter((task) => task.statusCode !== "CANCELLED");
    const completed = countable.filter((task) => ["DONE", "COMPLETED"].includes(task.statusCode)).length;
    return {
      done: statusSummaryTasks.filter((task) => ["DONE", "COMPLETED"].includes(task.statusCode)).length,
      inProgress: statusSummaryTasks.filter((task) => ["IN_PROGRESS", "INTERNAL_REVIEW", "WAITING_CLIENT", "REVISION"].includes(task.statusCode)).length,
      onHold: statusSummaryTasks.filter((task) => ["ON_HOLD", "BLOCKED"].includes(task.statusCode)).length,
      countable,
      completed,
      completionRate: countable.length ? Math.round(completed / countable.length * 100) : 0,
    };
  }, [statusSummaryTasks]);
  const { done, inProgress, onHold, countable, completed, completionRate } = summary;
  const missingSchedule = useMemo(() => filteredTasks.filter((task) => !task.plannedStartDate || !task.dueDate).length, [filteredTasks]);
  const today = localDateValue();
  const overdueHoldRanges = useMemo(() => new Map(filteredTasks
    .map((task) => [task.id, overdueTaskHoldRange(task, today)])
    .filter(([, range]) => Boolean(range))), [filteredTasks, today]);
  const timelineEnd = useMemo(() => [...overdueHoldRanges.values()]
    .reduce((latest, range) => !latest || range.endDate > latest ? range.endDate : latest, timeline.end), [overdueHoldRanges, timeline.end]);
  const days = useMemo(() => buildGanttAxis(
    timeline.start,
    timelineEnd,
    Math.ceil(Math.max(0, ganttViewportWidth - ganttLabelWidth) / GANTT_DAY_WIDTH),
  ), [timeline.start, timelineEnd, ganttViewportWidth, ganttLabelWidth]);
  const months = useMemo(() => days.reduce((items, day) => {
    const last = items[items.length - 1];
    if (last?.key === day.monthKey) last.count += 1;
    else items.push({ key: day.monthKey, tone: day.monthTone, label: `${Number(day.monthKey.slice(0, 4))}년 ${Number(day.monthKey.slice(5, 7))}월`, count: 1 });
    return items;
  }, []), [days]);
  const ganttTrackWidth = days.length * GANTT_DAY_WIDTH;
  const todayIndex = days.findIndex((day) => day.iso === today);
  const ganttGroups = useMemo(() => groupGanttTasks(filteredTasks, taskScheduleMedia), [filteredTasks]);
  const ganttWindowRows = useMemo(() => ganttGroups.flatMap(group => [{ id: "group:" + group.label, group }, ...group.tasks.map(task => ({ id: task.id, task, group }))]), [ganttGroups]);
  const ganttWindow = useWindowedRows(ganttWindowRows, ganttScrollRef, { estimate: row => row.task ? 33 : 28, disabled: displayMode !== "gantt" || draggingTaskIds.length > 0 });
  const ganttTasks = filteredTasks;
  const ganttRowIndexById = useMemo(() => new Map(ganttTasks.map((task, index) => [task.id, index])), [ganttTasks]);
  const ganttCategoryColor = (category) => ({
    "마케팅": "#0058ff",
    "디자인": "#c2318a",
    "영상": "#d42b20",
    "YouTube": "#d42b20",
    "유튜브": "#d42b20",
    "Instagram": "#c2318a",
    "인스타그램": "#c2318a",
    "네이버": "#0b9d4e",
    "네이버블로그": "#0b9d4e",
    "네이버 블로그": "#0b9d4e",
    "SEO": "#b06800",
    "TikTok": "#1b2430",
    "틱톡": "#1b2430",
    "Ads": "#b06800",
    "광고": "#b06800",
  }[category] || "#6e7177");
  const ganttFillColor = (task) => {
    const color = ganttCategoryColor(taskScheduleMedia(task));
    if (task.statusCode === "DONE") return color;
    if (["ON_HOLD", "BLOCKED"].includes(task.statusCode)) return `color-mix(in srgb, ${color} 16%, #fff)`;
    if (["IN_PROGRESS", "INTERNAL_REVIEW", "WAITING_CLIENT", "REVISION"].includes(task.statusCode)) return `color-mix(in srgb, ${color} 68%, #fff)`;
    return `color-mix(in srgb, ${color} 30%, #fff)`;
  };
  const scheduleClass = (task) => {
    if (task.statusCode === "DONE") return "is-done";
    if (["ON_HOLD", "BLOCKED"].includes(task.statusCode)) return "is-hold";
    if (task.streamCode === "YOUTUBE") return "is-youtube";
    if (task.streamCode === "INSTAGRAM") return "is-instagram";
    if (task.streamCode === "SEO") return "is-seo";
    return "is-active";
  };
  ganttTasksRef.current = ganttTasks;
  daysRef.current = days;

  useEffect(() => {
    const available = new Set(tasks.map((task) => task.id));
    setSelectedTaskIds((current) => {
      const next = new Set([...current].filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [tasks]);

  const selectTask = (taskId, checked, options = {}) => {
    setBulkDeleteArmed(false);
    const anchorTaskId = selectionAnchorRef.current;
    setSelectedTaskIds((current) => {
      if (options.shiftKey && anchorTaskId != null) {
        return selectTaskRange(filteredTasks, current, anchorTaskId, taskId, checked);
      }
      const next = new Set(current);
      if (checked) next.add(taskId); else next.delete(taskId);
      return next;
    });
    selectionAnchorRef.current = taskId;
  };
  const selectAllVisible = (checked) => {
    setBulkDeleteArmed(false);
    selectionAnchorRef.current = null;
    setSelectedTaskIds((current) => {
      const next = new Set(current);
      filteredTasks.forEach((task) => { if (checked) next.add(task.id); else next.delete(task.id); });
      return next;
    });
  };
  const saveUpdateChunks = async (updates) => {
    for (let offset = 0; offset < updates.length; offset += 40) {
      const batch = updates.slice(offset, offset + 40);
      if (onBatchUpdate) await onBatchUpdate(batch);
      else for (const update of batch) {
        if (update.operation === "ARCHIVE") await onArchive(update.task);
        else await onUpdate(update.task, update.fields);
      }
    }
  };
  const applyBulkUpdate = async () => {
    if (bulkSave.status === "saving") return;
    if (!bulkStatus && !bulkOwner && !bulkVisibility) {
      setBulkSave({ status: "error", error: "변경할 상태, 담당 또는 고객 공개 범위를 선택해 주세요." });
      return;
    }
    const selectedTasks = tasks.filter((task) => selectedTaskIds.has(task.id));
    if (!selectedTasks.length) return;
    const updates = selectedTasks.map((task) => ({
      task,
      fields: {
        ...(bulkStatus ? taskStatusMutationFields(bulkStatus, task) : {}),
        ...(bulkOwner ? { responsible_org_code: bulkOwner } : {}),
        ...(bulkVisibility ? { visibility_code: bulkVisibility } : {}),
      },
    }));
    setBulkSave({ status: "saving", error: "" });
    try {
      await saveUpdateChunks(updates);
      setSelectedTaskIds(new Set());
      setBulkStatus("");
      setBulkOwner("");
      setBulkVisibility("");
      setBulkDeleteArmed(false);
      setBulkSave({ status: "saved", error: "" });
    } catch (error) {
      setBulkSave({ status: "error", error: error?.message || "일괄 변경을 저장하지 못했습니다." });
    }
  };
  const applyBulkArchive = async () => {
    if (bulkSave.status === "saving") return;
    const selectedTasks = tasks.filter((task) => selectedTaskIds.has(task.id));
    if (!selectedTasks.length) return;
    if (!bulkDeleteArmed) {
      setBulkDeleteArmed(true);
      setBulkSave({ status: "idle", error: "삭제할 업무가 맞으면 삭제 확정을 한 번 더 눌러 주세요." });
      return;
    }
    setBulkSave({ status: "saving", error: "" });
    try {
      await saveUpdateChunks(selectedTasks.map((task) => ({ task, operation: "ARCHIVE", fields: {} })));
      setSelectedTaskIds(new Set());
      selectionAnchorRef.current = null;
      setBulkDeleteArmed(false);
      setBulkSave({ status: "saved", error: "" });
    } catch (error) {
      setBulkDeleteArmed(false);
      setBulkSave({ status: "error", error: error?.message || "선택 업무를 삭제하지 못했습니다." });
    }
  };
  const stopTaskAutoScroll = useCallback(() => {
    const scroll = dragAutoScrollRef.current;
    if (scroll.frame) globalThis.cancelAnimationFrame?.(scroll.frame);
    dragAutoScrollRef.current = { frame: null, container: null, speed: 0 };
  }, []);
  const runTaskAutoScroll = useCallback(() => {
    const tick = () => {
      const scroll = dragAutoScrollRef.current;
      if (!scroll.container || !scroll.speed) {
        scroll.frame = null;
        return;
      }
      scroll.container.scrollTop += scroll.speed;
      scroll.frame = globalThis.requestAnimationFrame?.(tick) || null;
    };
    if (!dragAutoScrollRef.current.frame) dragAutoScrollRef.current.frame = globalThis.requestAnimationFrame?.(tick) || null;
  }, []);
  const updateTaskAutoScroll = useCallback((event) => {
    const container = event.currentTarget?.closest?.(".reference-task-scroll, .reference-gantt-scroll");
    if (!container) return;
    const bounds = container.getBoundingClientRect();
    const edge = Math.min(72, Math.max(44, bounds.height * 0.12));
    const topDistance = event.clientY - bounds.top;
    const bottomDistance = bounds.bottom - event.clientY;
    let speed = 0;
    if (topDistance < edge) speed = -Math.ceil((edge - Math.max(0, topDistance)) / edge * 18);
    else if (bottomDistance < edge) speed = Math.ceil((edge - Math.max(0, bottomDistance)) / edge * 18);
    dragAutoScrollRef.current.container = container;
    dragAutoScrollRef.current.speed = speed;
    if (speed) runTaskAutoScroll();
  }, [runTaskAutoScroll]);
  const startTaskDrag = (taskId) => {
    const ids = selectedTaskIds.has(taskId)
      ? filteredTasks.filter((task) => selectedTaskIds.has(task.id)).map((task) => task.id)
      : [taskId];
    setDraggingTaskId(taskId);
    setDraggingTaskIds(ids);
    setTaskDropIndicator(null);
    draggingTaskIdsRef.current = ids;
    taskDropIndicatorRef.current = null;
  };
  const finishTaskDrag = useCallback(() => {
    stopTaskAutoScroll();
    setDraggingTaskId(null);
    setDraggingTaskIds([]);
    setTaskDropIndicator(null);
    draggingTaskIdsRef.current = [];
    taskDropIndicatorRef.current = null;
  }, [stopTaskAutoScroll]);
  useEffect(() => () => stopTaskAutoScroll(), [stopTaskAutoScroll]);
  const handleTaskDragOver = (event, targetTaskId) => {
    const draggedIds = draggingTaskIdsRef.current;
    if (!reorderEnabled || !draggedIds.length) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    updateTaskAutoScroll(event);
    if (draggedIds.includes(targetTaskId)) {
      setTaskDropIndicator(null);
      taskDropIndicatorRef.current = null;
      return;
    }
    const row = event.currentTarget?.closest?.(".task-schedule-row, .g-row") || event.currentTarget;
    const bounds = row?.getBoundingClientRect?.();
    const position = bounds && event.clientY > bounds.top + bounds.height / 2 ? "after" : "before";
    taskDropIndicatorRef.current = { taskId: targetTaskId, position };
    setTaskDropIndicator((current) => current?.taskId === targetTaskId && current.position === position ? current : { taskId: targetTaskId, position });
  };
  const dropTasksAt = async (targetTaskId) => {
    const sourceIds = draggingTaskIdsRef.current.length ? draggingTaskIdsRef.current.slice() : (draggingTaskId ? [draggingTaskId] : []);
    const indicator = taskDropIndicatorRef.current;
    const position = indicator?.taskId === targetTaskId ? indicator.position : "before";
    const targetTask = filteredTasks.find((task) => task.id === targetTaskId);
    const targetMediaCode = taskScheduleMediaCode(targetTask);
    finishTaskDrag();
    if (!reorderEnabled || !sourceIds.length || !targetTask) return;
    const ordered = reorderTaskSchedule(filteredTasks, sourceIds, targetTaskId, position);
    if (ordered.every((task, index) => task.id === filteredTasks[index]?.id)) return;
    const sourceSet = new Set(sourceIds);
    const updates = ordered.map((task, index) => {
      const fields = { sort_order: (index + 1) * 10 };
      if (sourceSet.has(task.id) && targetMediaCode && taskScheduleMediaCode(task) !== targetMediaCode) fields.category_code = targetMediaCode;
      return { task, fields };
    }).filter(({ task, fields }) => Number(task.sortOrder) !== fields.sort_order || fields.category_code);
    if (!updates.length) return;
    setBulkSave({ status: "saving", error: "" });
    try {
      await saveUpdateChunks(updates);
      setBulkSave({ status: "saved", error: "" });
    } catch (error) {
      setBulkSave({ status: "error", error: error?.message || "업무 순서를 저장하지 못했습니다." });
    }
  };
  const updateGanttQuickField = async (task, field, value) => {
    const fields = field === "status_code" ? taskStatusMutationFields(value, task) : { [field]: value };
    setGanttSave({ status: "saving", saved: 0, total: 1, error: "" });
    try {
      await onUpdate(task, fields);
      setGanttSave({ status: "saved", saved: 1, total: 1, error: "" });
    } catch (error) {
      setGanttSave({ status: "error", saved: 0, total: 1, error: error?.message || "업무를 저장하지 못했습니다." });
    }
  };
  const clearGanttAxisHighlight = useCallback(() => {
    const root = matrixRef.current;
    if (root) {
      root.querySelectorAll(".is-axis-hover-row, .is-axis-hover-column, .is-axis-hover-intersection").forEach((element) => {
        element.classList.remove("is-axis-hover-row", "is-axis-hover-column", "is-axis-hover-intersection");
      });
    }
    ganttHoverRef.current = { rowIndex: null, dayIndex: null };
  }, []);
  const highlightGanttAxes = useCallback((event) => {
    if (paintRef.current) return;
    const root = matrixRef.current;
    const cell = event.target.closest?.(".g-c[data-gantt-row-index][data-gantt-day-index]");
    if (!root || !cell || !root.contains(cell)) {
      clearGanttAxisHighlight();
      return;
    }
    const rowIndex = Number(cell.dataset.ganttRowIndex);
    const dayIndex = Number(cell.dataset.ganttDayIndex);
    const previous = ganttHoverRef.current;
    if (previous.rowIndex === rowIndex && previous.dayIndex === dayIndex) return;
    clearGanttAxisHighlight();
    root.querySelector(`.g-row[data-gantt-row-index="${rowIndex}"]`)?.classList.add("is-axis-hover-row");
    root.querySelectorAll(`[data-gantt-day-index="${dayIndex}"]`).forEach((element) => element.classList.add("is-axis-hover-column"));
    cell.classList.add("is-axis-hover-intersection");
    ganttHoverRef.current = { rowIndex, dayIndex };
  }, [clearGanttAxisHighlight]);

  const repaintGantt = useCallback((paint) => {
    const root = matrixRef.current;
    if (!root || !paint?.drafts) return;
    const rowStart = Math.min(paint.anchor.rowIndex, paint.target.rowIndex);
    const rowEnd = Math.max(paint.anchor.rowIndex, paint.target.rowIndex);
    const dayStart = Math.min(paint.anchor.dayIndex, paint.target.dayIndex);
    const dayEnd = Math.max(paint.anchor.dayIndex, paint.target.dayIndex);
    const axisDays = paint.anchor.axisDays;
    const previous = paint.previewRange || { rowStart, rowEnd };
    const dirtyRowStart = Math.min(previous.rowStart, rowStart);
    const dirtyRowEnd = Math.max(previous.rowEnd, rowEnd);
    for (let dirtyRow = dirtyRowStart; dirtyRow <= dirtyRowEnd; dirtyRow += 1) {
      const taskId = paint.rows[dirtyRow]?.id;
      const dates = new Set(paint.drafts.get(taskId) || []);
      root.querySelectorAll(`.g-c[data-gantt-row-index="${dirtyRow}"]`).forEach((cell) => {
        const rowIndex = Number(cell.dataset.ganttRowIndex);
        const dayIndex = Number(cell.dataset.ganttDayIndex);
        const date = axisDays[dayIndex];
        const active = dates.has(date);
        const runStart = active && !dates.has(axisDays[dayIndex - 1]);
        const runEnd = active && !dates.has(axisDays[dayIndex + 1]);
        const preview = rowIndex >= rowStart && rowIndex <= rowEnd && dayIndex >= dayStart && dayIndex <= dayEnd;
        cell.classList.toggle("on", active);
        cell.classList.toggle("rs", runStart);
        cell.classList.toggle("re", runEnd);
        cell.classList.toggle("is-paint-preview", preview);
        cell.classList.toggle("is-paint-add", preview && paint.mode === "paint");
        cell.classList.toggle("is-paint-erase", preview && paint.mode === "erase");
      });
    }
    paint.previewRange = { rowStart, rowEnd, dayStart, dayEnd };
  }, []);

  const paintTo = useCallback((rowIndex, dayIndex) => {
    const paint = paintRef.current;
    if (!paint || (paint.target.rowIndex === rowIndex && paint.target.dayIndex === dayIndex)) return;
    paint.target = { rowIndex, dayIndex };
    paint.drafts = paintGanttRectangle(paint.rows, paint.anchor, paint.target, paint.mode);
    repaintGantt(paint);
  }, [repaintGantt]);

  const finishGanttPaint = useCallback(async () => {
    const paint = paintRef.current;
    if (!paint) return;
    paintRef.current = null;
    matrixRef.current?.classList.remove("is-painting");
    const changes = paint.rows.filter((row) => !scheduleDatesEqual(row.scheduleDates, paint.drafts.get(row.id)));
    if (!changes.length) {
      matrixRef.current?.querySelectorAll(".is-paint-preview, .is-paint-add, .is-paint-erase").forEach((cell) => cell.classList.remove("is-paint-preview", "is-paint-add", "is-paint-erase"));
      return;
    }

    setGanttDrafts(paint.drafts);
    setGanttSave({ status: "saving", saved: 0, total: changes.length, error: "" });
    let saved = 0;
    try {
      const updates = changes.map((row) => {
        const dates = paint.drafts.get(row.id) || [];
        const bounds = scheduleDateBounds(dates);
        return {
          task: row.task,
          fields: {
            planned_start_date: bounds.start,
            due_date: bounds.end,
            schedule_dates_json: serializeScheduleDates(dates),
          },
        };
      });
      if (onBatchUpdate) {
        for (let offset = 0; offset < updates.length; offset += 40) {
          const batch = updates.slice(offset, offset + 40);
          await onBatchUpdate(batch);
          saved += batch.length;
          setGanttSave({ status: "saving", saved, total: changes.length, error: "" });
        }
      } else {
        for (const update of updates) {
          await onUpdate(update.task, update.fields);
          saved += 1;
          setGanttSave({ status: "saving", saved, total: changes.length, error: "" });
        }
      }
      setGanttSave({ status: "saved", saved, total: changes.length, error: "" });
    } catch (error) {
      setGanttSave({
        status: "error",
        saved,
        total: changes.length,
        error: error?.code === "field_not_allowed" || /field_not_allowed/i.test(error?.message || "")
          ? "Apps Script의 간트 일정 필드를 먼저 반영해야 합니다."
          : error?.message || "간트 일정을 저장하지 못했습니다.",
      });
    } finally {
      setGanttDrafts(null);
    }
  }, [onBatchUpdate, onUpdate]);

  useEffect(() => {
    const move = (event) => {
      if (!paintRef.current) return;
      event.preventDefault();
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.(".g-c[data-gantt-task-id]");
      if (!target || !matrixRef.current?.contains(target)) return;
      paintTo(Number(target.dataset.ganttRowIndex), Number(target.dataset.ganttDayIndex));
    };
    const end = () => { void finishGanttPaint(); };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [finishGanttPaint, paintTo]);

  const beginGanttPaint = (event) => {
    if (displayMode !== "gantt" || !canWrite || ganttSave.status === "saving" || event.button !== 0) return;
    const cell = event.target.closest?.(".g-c[data-gantt-task-id]");
    if (!cell || !matrixRef.current?.contains(cell)) return;
    clearGanttAxisHighlight();
    event.preventDefault();
    const rowIndex = Number(cell.dataset.ganttRowIndex);
    const dayIndex = Number(cell.dataset.ganttDayIndex);
    const axisDays = daysRef.current.map((day) => day.iso);
    const rows = ganttTasksRef.current.map((task) => ({ id: task.id, task, scheduleDates: taskScheduleDates(task) }));
    const active = new Set(rows[rowIndex]?.scheduleDates || []).has(axisDays[dayIndex]);
    const paint = {
      mode: active ? "erase" : "paint",
      anchor: { rowIndex, dayIndex, axisDays },
      target: { rowIndex: -1, dayIndex: -1 },
      rows,
      drafts: new Map(),
      previewRange: null,
    };
    paintRef.current = paint;
    matrixRef.current.classList.add("is-painting");
    paintTo(rowIndex, dayIndex);
  };
  const saveProjectStartDate = async () => {
    if (!canEditProject || !onProjectUpdate || !startDateDraft || startDateSaving) return;
    setStartDateSaving(true);
    setStartDateError("");
    try {
      await onProjectUpdate(project, startDateDraft);
    } catch (error) {
      setStartDateError(error?.code === "conflict" ? "다른 사용자가 먼저 변경했습니다." : error?.message || "착수일을 저장하지 못했습니다.");
    } finally {
      setStartDateSaving(false);
    }
  };

  const renderGanttTaskRow = (task, groupLabel, color, seriesChild = false) => {
    const rowIndex = ganttRowIndexById.get(task.id);
    const scheduleDates = ganttDrafts?.get(task.id) || taskScheduleDates(task);
    const scheduleSet = new Set(scheduleDates);
    const owner = taskResponsibleOrgLabel(task.responsibleOrgCode, project.clientName);
    const newTask = isNewTask(task, freshnessNow);
    const overdueHold = overdueHoldRanges.get(task.id);
    return <div data-window-id={task.id} data-gantt-row-index={rowIndex} className={`g-row${seriesChild ? " is-series-child" : ""}${newTask ? " is-new-task" : ""}${selectedTaskIds.has(task.id) ? " is-selected" : ""}${draggingTaskIds.includes(task.id) ? " is-dragging" : ""}${taskDropIndicator?.taskId === task.id ? ` is-drop-${taskDropIndicator.position}` : ""}`} key={task.id} style={{ "--fill": ganttFillColor(task), "--rail": color }}>
      <div className="g-lbl" title={`${groupLabel} · ${task.title}`} onDragOver={(event) => handleTaskDragOver(event, task.id)} onDrop={(event) => { if (!reorderEnabled) return; event.preventDefault(); void dropTasksAt(task.id); }}>
        {canWrite && <input type="checkbox" checked={selectedTaskIds.has(task.id)} onChange={(event) => selectTask(task.id, event.target.checked, { shiftKey: event.nativeEvent?.shiftKey || event.shiftKey })} aria-label={`${task.title} 선택`} />}
        {canWrite && <span className="g-reorder-handle" draggable={reorderEnabled} onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(task.id)); startTaskDrag(task.id); }} onDragEnd={finishTaskDrag} title={reorderEnabled ? "끌어서 선택 업무 순서 이동" : "필터를 해제하면 순서를 이동할 수 있습니다"}><GripVertical size={13} /></span>}
        <i className="g-rail-dot" />
        <button type="button" className="g-task-open nm" disabled={!canWrite} onClick={() => canWrite && setEditingTaskId(task.id)}>{task.title}</button>
        {newTask && <span className="g-new-badge">신규</span>}
        {taskHiddenFromClient(task) && <span className="g-client-hidden-badge" title="고객사 계정에는 표시되지 않습니다"><LockKeyhole size={9} />고객 숨김</span>}
        {canWrite ? <select className={`g-task-status is-${taskScheduleStatusGroup(task).toLowerCase()}`} aria-label={`${task.title} 상태`} value={editableTaskStatusCode(task.statusCode)} disabled={ganttSave.status === "saving"} onPointerDown={(event) => event.stopPropagation()} onChange={(event) => void updateGanttQuickField(task, "status_code", event.target.value)}>{trackerStatusOptions.map(([code, label]) => <option value={code} key={code}>{label}</option>)}</select> : <span className={`g-task-status is-${taskScheduleStatusGroup(task).toLowerCase()}`}>{({ ACTIVE: "진행중", HOLD: "보류", DONE: "완료", TODO: "미착수" })[taskScheduleStatusGroup(task)] || trackerStatusLabels[task.statusCode] || "미지정"}</span>}
        {showOwners && (canWrite ? <select className={`g-owner-select ${task.responsibleOrgCode === "POCKET" ? "op" : task.responsibleOrgCode === "NS" ? "on" : "oc"}`} aria-label={`${task.title} 담당`} value={task.responsibleOrgCode || "POCKET"} disabled={ganttSave.status === "saving"} onPointerDown={(event) => event.stopPropagation()} onChange={(event) => void updateGanttQuickField(task, "responsible_org_code", event.target.value)}>{taskResponsibleOrgOptions(project.clientName).map(([code, label]) => <option value={code} key={code}>{label}</option>)}</select> : <span className={`otag ${task.responsibleOrgCode === "POCKET" ? "op" : task.responsibleOrgCode === "NS" ? "on" : "oc"}`}>{owner}</span>)}
        {canWrite && <TaskRowActions compact task={task} onEdit={setEditingTaskId} onArchive={onArchive} disabled={ganttSave.status === "saving"} />}
      </div>
      <div className={`g-track ${canWrite ? "paint" : ""}`} style={{ width: `${ganttTrackWidth}px` }}>
        {days.map((day, dayIndex) => {
          const active = scheduleSet.has(day.iso);
          const starts = active && !scheduleSet.has(days[dayIndex - 1]?.iso);
          const ends = active && !scheduleSet.has(days[dayIndex + 1]?.iso);
          const overdueHeld = Boolean(overdueHold && day.iso >= overdueHold.startDate && day.iso <= overdueHold.endDate);
          const overdueStarts = overdueHeld && day.iso === overdueHold.startDate;
          const overdueEnds = overdueHeld && day.iso === overdueHold.endDate;
          return <div key={`${task.id}-${day.iso}`} data-r={task.id} data-ri={rowIndex} data-o={dayIndex} data-gantt-task-id={task.id} data-gantt-task-title={task.title} data-gantt-row-index={rowIndex} data-gantt-day-index={dayIndex} className={`g-c${ganttMonthClass(day)}${day.weekend ? " we" : ""}${day.iso === today ? " ref" : ""}${active ? " on" : ""}${starts ? " rs" : ""}${ends ? " re" : ""}${overdueHeld ? ` overdue-hold ${overdueHold.live ? "is-live" : "is-frozen"}` : ""}${overdueStarts ? " hold-start" : ""}${overdueEnds ? " hold-end" : ""}`} title={overdueHeld ? `${task.title} · 기한 초과 보류 ${day.iso}${overdueHold.live ? " (진행 중)" : " (종료)"}` : active ? `${task.title} · ${day.iso}` : day.iso} />;
        })}
        {todayIndex >= 0 && <div className="g-refline" style={{ left: `${todayIndex * GANTT_DAY_WIDTH}px` }} />}
      </div>
    </div>;
  };

  return <div className="campaign-schedule-board" aria-label="캠페인 운영 일정">
    {!summaryOnly && <>
    <QuoteSummary quote={project.quoteData} />
    <section className="campaign-board-progress" aria-label="전체 진행률"><div><span>전체 진행률</span><strong>{completionRate}<em>%</em></strong><small>완료 {completed}건 · 전체 {countable.length}건</small><div><i style={{ width: `${completionRate}%` }} /></div></div><div className="campaign-board-statuses"><button type="button" className={statusFilter === "ALL" ? "is-active" : ""} onClick={() => setStatusFilter("ALL")}><span>전체</span><strong>{countable.length}</strong></button><button type="button" className={statusFilter === "ACTIVE" ? "is-active" : ""} onClick={() => setStatusFilter((current) => toggleScheduleStatusFilter(current, "ACTIVE"))}><span>진행중</span><strong>{inProgress}</strong></button><button type="button" className={statusFilter === "DONE" ? "is-active" : ""} onClick={() => setStatusFilter((current) => toggleScheduleStatusFilter(current, "DONE"))}><span>완료</span><strong>{done}</strong></button><button type="button" className={statusFilter === "HOLD" ? "is-active" : ""} onClick={() => setStatusFilter((current) => toggleScheduleStatusFilter(current, "HOLD"))}><span>보류</span><strong>{onHold}</strong></button></div></section>
    <div className="campaign-schedule-toolbar reference-toolbar toolbar">
      <TaskWorkspaceTabs activeView={displayMode} onChange={onViewChange} canViewActivity={canViewActivity} />
      {activityMode ? <div className="task-activity-toolbar-copy">사용자가 생성·완료·변경한 업무만 표시합니다.</div> : canEditProject && <div className="schedule-start-date refbox"><label><span>착수일</span><input type="date" value={startDateDraft} disabled={startDateSaving} onChange={(event) => { setStartDateDraft(event.target.value); setStartDateError(""); }} /></label><button type="button" className="btn" disabled={startDateSaving || !startDateDraft || startDateDraft === (project.startDate || "")} onClick={saveProjectStartDate}>{startDateSaving ? "저장 중" : "저장"}</button>{startDateError && <small role="alert">{startDateError}</small>}</div>}
    </div>
    {!activityMode && <TaskScheduleFilters key={project.id} count={filteredTasks.length} total={tasks.length} onReset={resetScheduleFilters} groups={[
      { id: "media", label: "매체별", value: mediaFilter, options: mediaOptions, onChange: setMediaFilter },
      { id: "category", label: "업무 분야별", value: categoryFilter, options: scheduleCategoryFilters, onChange: setCategoryFilter },
      { id: "period", label: "기간별", value: scheduleFilter, options: scheduleWeekFilters, onChange: setScheduleFilter },
      { id: "status", label: "업무 상태별", value: statusFilter, options: scheduleStatusFilters, onChange: setStatusFilter },
      ...(canWrite ? [{ id: "owner", label: "담당 업무별", value: ownerFilter, options: ownerOptions, onChange: setOwnerFilter }] : []),
    ]} />}
    </>}
    {!activityMode && canWrite && selectedTaskIds.size > 0 && <section className="task-bulk-toolbar" aria-label="선택 업무 일괄 변경"><strong>{selectedTaskIds.size}개 선택</strong><label><span>상태</span><select value={bulkStatus} disabled={bulkSave.status === "saving"} onChange={(event) => { setBulkStatus(event.target.value); setBulkDeleteArmed(false); }}><option value="">변경 안 함</option>{trackerStatusOptions.map(([code, label]) => <option value={code} key={code}>{label}</option>)}</select></label><label><span>담당</span><select value={bulkOwner} disabled={bulkSave.status === "saving"} onChange={(event) => { setBulkOwner(event.target.value); setBulkDeleteArmed(false); }}><option value="">변경 안 함</option>{taskResponsibleOrgOptions(project.clientName).map(([code, label]) => <option value={code} key={code}>{label}</option>)}</select></label>{canManageVisibility && <label className="task-bulk-visibility"><span>고객사</span><select value={bulkVisibility} disabled={bulkSave.status === "saving"} onChange={(event) => { setBulkVisibility(event.target.value); setBulkDeleteArmed(false); }}><option value="">변경 안 함</option><option value="PROJECT_TEAM">숨김 · 내부만</option><option value="CLIENT">공개</option></select></label>}<button type="button" className="btn primary" disabled={bulkSave.status === "saving"} onClick={() => void applyBulkUpdate()}>{bulkSave.status === "saving" ? <LoaderCircle size={13} className="spin" /> : <Check size={13} />}일괄 적용</button><button type="button" className={`btn task-bulk-delete${bulkDeleteArmed ? " is-armed" : ""}`} disabled={bulkSave.status === "saving"} onClick={() => void applyBulkArchive()}>{bulkSave.status === "saving" && bulkDeleteArmed ? <LoaderCircle size={13} className="spin" /> : <Trash2 size={13} />}{bulkDeleteArmed ? `${selectedTaskIds.size}개 삭제 확정` : "선택 삭제"}</button><button type="button" className="btn" disabled={bulkSave.status === "saving"} onClick={() => { setSelectedTaskIds(new Set()); selectionAnchorRef.current = null; setBulkStatus(""); setBulkOwner(""); setBulkVisibility(""); setBulkDeleteArmed(false); setBulkSave({ status: "idle", error: "" }); }}>선택 해제</button>{bulkSave.error && <small role="alert">{bulkSave.error}</small>}</section>}
    <section ref={schedulePanelRef} className="task-timeline panel campaign-schedule-surface reference-schedule-panel" aria-label="업무 일정">
      <header className="campaign-schedule-table-heading panel-head reference-panel-head"><div><h2>{summaryOnly ? "프로젝트 간트" : activityMode ? "업무 로그" : displayMode === "gantt" ? "타임라인" : "업무 일정"}</h2><span className="hint">{activityMode ? "업무명과 변경 내용을 확인할 수 있는 누적 사용자 작업 이력" : <>{filteredTasks.length}건 표시{displayMode === "gantt" ? " · 머리글과 왼쪽 업무명 고정" : canWrite ? " · 업무명 수정 · 이동 손잡이로 순서 변경" : " · 업무명과 일정을 확인"}</>}</span>{!activityMode && ganttSave.status !== "idle" && <small className={`gantt-save-state is-${ganttSave.status}`}>{ganttSave.status === "saving" ? `업무 저장 중 ${ganttSave.saved}/${ganttSave.total}` : ganttSave.status === "saved" ? `${ganttSave.saved}개 업무 일정 저장 완료` : ganttSave.error}</small>}</div><div>{activityMode ? <button className="btn" type="button" onClick={() => onLoadActivity?.()} disabled={activityState?.status === "loading" || activityState?.loadingMore}>{activityState?.status === "loading" ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />}새로고침</button> : <>{canWrite && onCreate && <button type="button" className="btn task-schedule-create" onClick={() => onCreate("task-completed")}><Check size={13} />완료 업무 추가</button>}{canWrite && onCreate && <button type="button" className="btn primary task-schedule-create" onClick={() => onCreate("task")}><Plus size={13} />업무 추가</button>}</>}</div></header>
      {displayMode === "gantt" && canWrite && <div className="g-hint"><span>✎</span><span>칸을 클릭하면 칠해지고, 다시 누르면 지워집니다. 옆으로 끌면 여러 칸을 한 번에 — 시작일·종료일·기간은 칠한 범위에 맞춰 자동으로 바뀝니다.</span></div>}
      {activityMode ? <TaskActivityLog state={activityState} tasks={tasks} clientName={project.clientName} onRefresh={() => onLoadActivity?.()} onLoadMore={(cursor) => onLoadActivity?.({ append: true, cursor })} /> : filteredTasks.length === 0 ? <EmptyState title={summaryOnly ? "등록된 업무가 없습니다" : "조건에 맞는 업무가 없습니다"} description={summaryOnly ? "업무를 등록하면 같은 일정이 여기에 표시됩니다." : "상태·카테고리·일정 필터를 변경해 주세요."} /> : displayMode === "gantt" && !days.length ? <EmptyState title={`일정 미등록 ${missingSchedule}건`} description="프로젝트 기간 또는 업무 날짜를 먼저 입력해 주세요." /> : displayMode === "table" ? <TaskScheduleInlineTable tasks={filteredTasks} project={project} canWrite={canWrite} onUpdate={onUpdate} onEdit={setEditingTaskId} onArchive={onArchive} ganttDrafts={ganttDrafts} freshnessNow={freshnessNow} scheduleClass={scheduleClass} mediaColor={ganttCategoryColor} selectedTaskIds={selectedTaskIds} onSelectTask={selectTask} onSelectAll={selectAllVisible} reorderEnabled={reorderEnabled} draggingTaskIds={draggingTaskIds} dropIndicator={taskDropIndicator} onDragStart={startTaskDrag} onDragEnd={finishTaskDrag} onDragOverTask={handleTaskDragOver} onDropTask={(taskId) => void dropTasksAt(taskId)} /> : <div ref={ganttScrollRef} className="reference-gantt-scroll scroll"><div id="gantt" ref={matrixRef} onPointerDown={beginGanttPaint} onPointerMove={highlightGanttAxes} onPointerLeave={clearGanttAxisHighlight} className="gantt reference-gantt" style={{ width: `${ganttLabelWidth + ganttTrackWidth}px`, minWidth: `${ganttLabelWidth + ganttTrackWidth}px`, "--gantt-label-width": `${ganttLabelWidth}px`, "--gantt-day-width": `${GANTT_DAY_WIDTH}px` }}>
        <div className="g-hrow"><div className="g-lbl g-corner">{canWrite && <input type="checkbox" checked={Boolean(filteredTasks.length && filteredTasks.every((task) => selectedTaskIds.has(task.id)))} onChange={(event) => selectAllVisible(event.target.checked)} aria-label="표시된 업무 전체 선택" />}<span className="nm">매체 · 업무</span></div><div className="g-hstack" style={{ width: `${ganttTrackWidth}px` }}><div className="g-months">{months.map((month) => <div className={`g-m month-tone-${month.tone}`} key={month.key} style={{ width: `${month.count * GANTT_DAY_WIDTH}px` }}>{month.label}</div>)}</div><div className="g-days">{days.map((day, dayIndex) => <div key={day.iso} data-gantt-day-index={dayIndex} className={`g-d${ganttMonthClass(day)}${day.weekend ? " we" : ""}${day.weekday === "일" ? " sun" : ""}${day.iso === today ? " ref" : ""}`}><span>{day.day}</span><span className="dw">{day.weekday}</span></div>)}</div></div></div>
        {ganttWindow.before > 0 && <div aria-hidden="true" style={{ height: ganttWindow.before }} />}
        {ganttWindowRows.slice(ganttWindow.start, ganttWindow.end).map(row => {
          const group = row.group;
          const color = ganttCategoryColor(group.label);
          if (row.task) return renderGanttTaskRow(row.task, group.label, color);
          const groupDone = group.tasks.filter(task => task.statusCode === "DONE").length;
          return <div key={row.id} data-window-id={row.id} className="g-grow"><div className="g-lbl" style={{ "--rail": color }}><span className="nm">{group.label}</span><span className="g-gcount">{groupDone}/{group.tasks.length}</span></div><div className="g-track g-gtrack" style={{ width: `${ganttTrackWidth}px` }}>{days.map((day, dayIndex) => <div key={`${group.label}-${day.iso}`} data-gantt-day-index={dayIndex} className={`g-c${ganttMonthClass(day)} ${day.weekend ? "we" : ""} ${day.iso === today ? "ref" : ""}`} />)}{todayIndex >= 0 && <div className="g-refline" style={{ left: `${todayIndex * GANTT_DAY_WIDTH}px` }} />}</div></div>;
        })}
        {ganttWindow.after > 0 && <div aria-hidden="true" style={{ height: ganttWindow.after }} />}
      </div></div>}
      {displayMode === "gantt" && <div className="g-legend">{ganttGroups.map((group) => <span key={group.label}><i style={{ background: ganttCategoryColor(group.label) }} />{group.label}</span>)}<span><i style={{ background: "#8a93a3", opacity: .3 }} />예정 = 옅게</span><span><i className="g-overdue-hold-legend" />기한 초과 보류</span><span><i className="g-weekend-legend" />주말</span><span><i className="g-today-legend" />기준일 {today}</span></div>}
      {editingTaskId && canWrite && <TaskEditModal key={editingTaskId} task={tasks.find((task) => task.id === editingTaskId)} clientName={project.clientName} onUpdate={onUpdate} onClose={() => setEditingTaskId(null)} />}
    </section>
    {!summaryOnly && !activityMode && <ProjectIssuePanel issues={issues} project={project} canWrite={canWriteIssues} actorName={actorName} onCreate={onIssueCreate} onUpdate={onIssueUpdate} onArchive={onIssueArchive} />}
  </div>;
}


export { IssueRequestCreateModal, GANTT_DAY_WIDTH, statusClass, formatSyncTime, EmptyState, LoadingState, ErrorState, FormSelect, trackerStatusOptions, trackerStatusLabels, editableTaskStatusCode, trackerDate, TaskEditModal, taskActivityValue, taskActivityDateFilters, taskActivityDateLabel, TaskActivityLog, taskDurationDays, taskInlineDraft, validInlineTaskUrl, compactTaskDateLabel, CompactTaskDateInput, TaskRowActions, TaskScheduleInlineRow, TaskScheduleInlineTable, scheduleStatusFilters, scheduleCategoryFilters, scheduleWeekFilters, ScheduleFilterButtons, TaskScheduleFilters, TaskWorkspaceTabs, issueStatusOrder, issueStatusLabels, ProjectIssueRow, ProjectIssuePanel, TaskScheduleTimeline, localDateValue };
