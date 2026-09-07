import { useEffect, useRef, useState } from "react";
import { AlertCircle, CalendarDays, Check, ChevronDown, ClipboardCheck, LoaderCircle, Plus, X } from "lucide-react";
import { taskCreateInitialFields, taskCreateSubmissionFields, taskCreateValidationError, taskDateRangeDuration, taskDateRangePreset, taskResponsibleOrgOptions } from "./taskForm.js";
import { acquireBodyScrollLock } from "./bodyScrollLock.js";
import "./taskCreateModal.css";

const streams = [["MARKETING","마케팅"],["DESIGN","디자인"],["VIDEO","영상"]];
const statuses = [["NOT_STARTED","미착수"],["IN_PROGRESS","진행"],["DONE","완료"],["ON_HOLD","보류"]];
const presets = [["NEXT_7","오늘부터 7일"],["LAST_7","최근 7일"],["THIS_WEEK","이번주"],["NEXT_WEEK","다음주"],["UNSCHEDULED","일정 미정"]];

function Choices({ label, options, value, onChange, required = false }) {
  return <fieldset className={`task-create-choices${required ? " is-required" : ""}`} aria-required={required || undefined}><legend>{label}{required && <small className="task-create-required-badge">필수</small>}</legend><div>{options.map(([code,name]) => <button type="button" key={code} aria-pressed={value === code} onClick={() => onChange(code)}>{value === code && <Check size={12}/>} {name}</button>)}</div></fieldset>;
}

export function TaskCreateModal({ completed = false, role, clientName, onClose, onSubmit, todayValue }) {
  const [initial] = useState(() => taskCreateInitialFields(role, completed ? "completed" : "default", todayValue));
  const [fields,setFields] = useState(initial);
  const [saving,setSaving] = useState(false);
  const [error,setError] = useState("");
  const [discard,setDiscard] = useState(false);
  const dialog = useRef(null);
  const submitLock = useRef(false);
  const duration = taskDateRangeDuration(fields);
  const done = fields.status_code === "DONE";
  const title = completed ? "완료 업무 추가" : "업무 추가";
  const owners = taskResponsibleOrgOptions(clientName);
  const dirty = JSON.stringify(fields) !== JSON.stringify(initial);
  const setField = (name,value) => { setFields(current => ({...current,[name]:value})); setError(""); };
  const close = () => { if (!saving && !submitLock.current) dirty ? setDiscard(true) : onClose(); };
  useEffect(() => {
    const previousFocus = document.activeElement;
    const releaseScrollLock = acquireBodyScrollLock();
    dialog.current?.querySelector("input")?.focus();
    return () => { releaseScrollLock(); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);
  const keyboard = event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key !== "Tab") return;
    const focusable = [...dialog.current.querySelectorAll("button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,[tabindex='0']")].filter(el => el.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  const submit = async event => {
    event.preventDefault();
    if (submitLock.current) return;
    const validation = taskCreateValidationError(fields);
    if (validation) { setError(validation); return; }
    submitLock.current = true; setSaving(true); setError("");
    try { await onSubmit("task", taskCreateSubmissionFields(fields)); onClose(); }
    catch (failure) { setError(failure?.message || "저장하지 못했습니다. 입력 내용은 유지됩니다."); }
    finally { submitLock.current = false; setSaving(false); }
  };
  return <div className="modal-backdrop task-create-backdrop" onMouseDown={event => {if(event.target === event.currentTarget) close();}}>
    <section ref={dialog} className="task-create-dialog" role="dialog" aria-modal="true" aria-labelledby="task-create-title" onKeyDown={keyboard}>
      <header><div className="task-create-heading"><span className="task-create-mark"><ClipboardCheck size={21}/></span><div><p>{clientName || "프로젝트"} · 업무 등록</p><h2 id="task-create-title">{title}</h2></div></div><button className="task-create-close" type="button" aria-label="닫기" disabled={saving} onClick={close}><X size={19}/></button></header>
      <form onSubmit={submit} noValidate>
        <div className="task-create-body"><div className="task-create-required-note"><span>필수</span> 표시 항목은 기본 선택값을 확인해 주세요.</div><fieldset className="task-create-fields" disabled={saving}>
          <label className="task-create-field task-create-title-field"><span>어떤 업무인가요? <small>선택</small></span><input name="title" maxLength={200} value={fields.title} onChange={event => setField("title",event.target.value)} placeholder="비워두면 ‘제목 없는 업무’로 등록됩니다"/></label>
          <label className="task-create-field"><span>세부내용 <small>선택</small></span><textarea name="description" rows={2} maxLength={10000} value={fields.description} onChange={event => setField("description",event.target.value)} placeholder="해야 할 일과 완료 기준을 간단히 적어 주세요."/></label>
          <div className="task-create-two-column">
            <Choices required label="업무 분야" options={streams} value={fields.workstream_code} onChange={value => setField("workstream_code",value)}/>
            <Choices required label="담당" options={owners} value={fields.responsible_org_code} onChange={value => setField("responsible_org_code",value)}/>
          </div>
          <section className="task-create-schedule" aria-label="업무 일정 설정">
            <div className="task-create-section-heading"><strong><CalendarDays size={15}/> 업무 일정</strong><span>{duration ? `총 ${duration}일` : "일정 미정"}</span></div>
            <div className="task-create-date-presets" role="group" aria-label="일정 빠른 선택">{presets.map(([code,label]) => {
              const dates = taskDateRangePreset(code,todayValue);
              const selected = fields.planned_start_date === dates.planned_start_date && fields.due_date === dates.due_date;
              return <button type="button" key={code} aria-pressed={selected} onClick={() => {setFields(current => ({...current,...dates}));setError("");}}>{label}</button>;
            })}</div>
            <div className="task-create-two-column"><label className="task-create-field"><span>시작일</span><input name="planned_start_date" type="date" value={fields.planned_start_date} max={fields.due_date || undefined} onChange={event => setField("planned_start_date",event.target.value)}/></label><label className="task-create-field"><span>종료일</span><input name="due_date" type="date" value={fields.due_date} min={fields.planned_start_date || undefined} onChange={event => setField("due_date",event.target.value)}/></label></div>
          </section>
          <div className="task-create-status-row">{completed ? <div className="task-create-done-note"><Check size={16}/><span>완료 상태로 등록됩니다</span></div> : <Choices required label="현재 상태" options={statuses} value={fields.status_code} onChange={value => setFields(current => ({...current,status_code:value,...(value === "DONE" ? {progress_percent:100} : {})}))}/>}<label className="task-create-field task-create-progress is-required"><span>진행률 <small className="task-create-required-badge">필수</small></span><div><input required name="progress_percent" type="number" min={0} max={100} readOnly={done} value={fields.progress_percent} onChange={event => setField("progress_percent",event.target.value)}/><span>%</span></div></label></div>
          <details className="task-create-details" open={completed || undefined}><summary>추가 설정 <span>단계·우선순위·링크·비고</span><ChevronDown size={15}/></summary><div>
            <div className="task-create-two-column"><label className="task-create-field"><span>단계</span><select name="phase_code" value={fields.phase_code} onChange={event => setField("phase_code",event.target.value)}>{[["P0","구축"],["M1","운영 1개월차"],["M2","운영 2개월차"],["M3","운영 3개월차"]].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="task-create-field"><span>우선순위</span><select name="priority_code" value={fields.priority_code} onChange={event => setField("priority_code",event.target.value)}>{[["NORMAL","보통"],["HIGH","높음"],["CRITICAL","긴급"]].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
            <label className="task-create-field"><span>완료링크 <small>선택 · https://</small></span><input name="completion_url" type="url" value={fields.completion_url} onChange={event => setField("completion_url",event.target.value)} placeholder="결과물을 확인할 수 있는 주소"/></label>
            <label className="task-create-field"><span>비고</span><textarea name="remarks" rows={2} maxLength={10000} value={fields.remarks} onChange={event => setField("remarks",event.target.value)} placeholder="참고사항이나 일정 이슈"/></label>
            {role === "pocket" && <label className="task-create-field"><span>공개 범위</span><select name="visibility_code" value={fields.visibility_code} onChange={event => setField("visibility_code",event.target.value)}><option value="PROJECT_TEAM">프로젝트 팀</option><option value="CLIENT">고객 공개</option><option value="POCKET_ONLY">포켓 전용</option></select></label>}
          </div></details>
        </fieldset></div>
        {error && <div className="task-create-message is-error" role="alert"><AlertCircle size={15}/><span>{error}</span></div>}
        {discard && <div className="task-create-message" role="alert"><span>작성 중인 내용을 버릴까요?</span><button type="button" disabled={saving} onClick={() => setDiscard(false)}>계속 작성</button><button type="button" disabled={saving} onClick={() => { if (!submitLock.current) onClose(); }}>버리고 닫기</button></div>}
        <footer><span>{owners.find(([code]) => code === fields.responsible_org_code)?.[1]} 담당 · {duration ? `${duration}일 일정` : "일정 미정"}</span><div><button type="button" className="task-create-cancel" disabled={saving} onClick={close}>취소</button><button type="submit" className="task-create-submit" disabled={saving}>{saving ? <LoaderCircle size={15} className="spin"/> : completed ? <Check size={15}/> : <Plus size={15}/>} {saving ? "저장 중" : title}</button></div></footer>
      </form>
    </section>
  </div>;
}
