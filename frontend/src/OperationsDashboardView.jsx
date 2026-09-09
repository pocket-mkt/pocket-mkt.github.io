import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowRight, CalendarDays, CheckCircle2, ChevronDown, CircleDot, Clock3, FolderKanban, Plus, X } from "lucide-react";
import IssueRequestCard from "./IssueRequestCard.jsx";
import IssueRequestCreateModal from "./IssueRequestCreateModal.jsx";
import DeadlineTaskLink from "./DeadlineTaskLink.jsx";
import { requestCreatedLabel } from "./progressBrief.js";
import { newestIssuesFirst } from "./issueOrder.js";
import "./operationsDashboard.css";
import "./operationsDashboardEnhancements.css";
import "./operationsIssueEnhancements.css";

const STATUS = { NOT_STARTED: ["미착수", "muted"], IN_PROGRESS: ["진행", "active"], DONE: ["완료", "done"], ON_HOLD: ["보류", "hold"], BLOCKED: ["보류", "hold"] };

function localDate(value = new Date()) { const offset = value.getTimezoneOffset() * 60_000; return new Date(value.getTime() - offset).toISOString().slice(0, 10); }
function parseDate(value) { const [year, month, day] = String(value || "").split("-").map(Number); return year && month && day ? new Date(year, month - 1, day) : new Date(); }
function moveDate(value, days) { const next = parseDate(value); next.setDate(next.getDate() + days); return localDate(next); }
function weekdayDate(value) { let next = String(value || localDate()); while ([0, 6].includes(parseDate(next).getDay())) next = moveDate(next, -1); return next; }
function shortDate(value) { if (!value) return "일정 없음"; const [, month, day] = String(value).split("-"); return `${Number(month)}.${Number(day)}`; }
function workWeek(value = localDate()) { const date = parseDate(value); const mondayOffset = (date.getDay() + 6) % 7; const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - mondayOffset); return { from: localDate(monday), to: moveDate(localDate(monday), 4) }; }
function weekLabel(from) { const reference = parseDate(moveDate(from, 3)); const first = new Date(reference.getFullYear(), reference.getMonth(), 1); const firstOffset = (first.getDay() + 6) % 7; const week = Math.floor((reference.getDate() + firstOffset - 1) / 7) + 1; return `${String(reference.getFullYear()).slice(2)}.${String(reference.getMonth() + 1).padStart(2, "0")}월 ${week}주차`; }
function splitLines(value) { return String(value || "").split(/\r?\n/).map((line) => line.trim().replace(/^[•·-]\s*/, "")).filter(Boolean); }

const MISC_PREFIX = "[기타]";
function isMiscMeeting(meeting) { return String(meeting?.title || "").trim().startsWith(MISC_PREFIX); }
function visibleMeetingTitle(meeting) { return String(meeting?.title || "회의록").replace(/^\[기타\]\s*/, "") || "회의록"; }
function meetingWeekItems(meetings, field) {
  return [...meetings]
    .sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")))
    .flatMap((meeting) => splitLines(meeting[field]).map((text, index) => ({
      id: `${meeting.id}-${field}-${index}`,
      text,
      date: meeting.date,
      clientName: isMiscMeeting(meeting) ? "기타" : meeting.clientName,
    })));
}

function StatusBadge({ code }) { const [label, tone] = STATUS[code] || [code || "미착수", "muted"]; return <span className={`ops-status is-${tone}`}>{label}</span>; }

function MeetingBody({ meeting }) {
  return <div className="ops-meeting-body">{[["회의내용", meeting.discussion], ["결정사항", meeting.decisions], ["후속업무", meeting.actionItems]].map(([title, value]) => <section key={title}><h3>{title}</h3>{splitLines(value).length ? <ul>{splitLines(value).map((line, index) => <li key={index}>{line}</li>)}</ul> : <p>기록된 내용이 없습니다.</p>}</section>)}</div>;
}

function FocusColumn({ title, items, tone, empty }) {
  const visible = items.slice(0, 5);
  return <section className={`is-${tone}`}><h3>{title}</h3>{visible.length ? <><ul>{visible.map((item) => <li key={item.id}><span>{item.clientName}</span><strong>{item.text}</strong><time>{item.date ? shortDate(item.date) : "기한 미정"}</time></li>)}</ul>{items.length > visible.length && <p className="ops-focus-more">외 {items.length - visible.length}건 · 아래 상세 기록에서 확인</p>}</> : <p>{empty}</p>}</section>;
}

function WeeklyMeetingFocus({ meetings, issues, week }) {
  const decisions = meetingWeekItems(meetings, "decisions");
  const actions = meetingWeekItems(meetings, "actionItems");
  const unresolved = [...issues].filter((issue) => !["DONE", "CLOSED", "COMPLETED", "CANCELLED"].includes(issue.statusCode)).sort((left, right) => String(left.dueDate || "9999-12-31").localeCompare(String(right.dueDate || "9999-12-31"))).map((issue) => ({ id: `issue-${issue.id}`, text: issue.body || issue.relatedTask || "내용 미등록", date: issue.dueDate, clientName: issue.clientName }));
  const columns = [["결정사항", decisions, "decision", "선택한 주에 등록된 결정사항이 없습니다."], ["후속업무", actions, "action", "선택한 주에 등록된 후속업무가 없습니다."], ["계속 확인할 요청", unresolved, "issue", "현재 미해결 확인 요청이 없습니다."]];
  return <section className="ops-panel ops-meeting-focus" aria-label="주간 핵심 사안"><header><div><span className="ops-panel-icon"><CircleDot size={17} /></span><div><h2>놓치면 안 되는 주간 사안</h2><p>{shortDate(week.from)}–{shortDate(week.to)} 결정·후속업무와 미해결 확인 요청</p></div></div><span className="ops-focus-count">결정 {decisions.length} · 후속 {actions.length} · 확인 {unresolved.length}</span></header><div className="ops-focus-columns">{columns.map(([title, items, tone, empty]) => <FocusColumn title={title} items={items} tone={tone} empty={empty} key={title} />)}</div></section>;
}

function ProjectTabs({ projects, value, onChange }) {
  return <nav className="ops-project-tabs" aria-label="프로젝트 필터"><button type="button" className={value === "all" ? "is-active" : ""} onClick={() => onChange("all")}><FolderKanban size={16} />전체 업체</button>{projects.map((project) => <button type="button" key={project.id} className={value === project.id ? "is-active" : ""} onClick={() => onChange(project.id)}>{project.clientName}<small>{project.inProgressTasks}건 진행</small></button>)}</nav>;
}

function IssueDetailModal({ issue, canWrite, actorName, onUpdate, onArchive, onUpdated, onArchived, onClose }) {
  const [current, setCurrent] = useState(issue);
  useEffect(() => setCurrent(issue), [issue]);
  if (!issue) return null;
  const displayedIssue = current?.id === issue.id ? current : issue;
  return <div className="ops-modal-backdrop" role="presentation" onMouseDown={onClose}><article className="ops-modal ops-issue-request-modal" role="dialog" aria-modal="true" aria-label="확인 요청 상세" onMouseDown={(event) => event.stopPropagation()}><header><div><span className="ops-panel-icon is-alert"><AlertCircle size={17} /></span><div><small>{displayedIssue.clientName} · {displayedIssue.projectName}</small><h2>확인 요청 상세</h2></div></div><button type="button" aria-label="닫기" onClick={onClose}><X size={19} /></button></header><div className="ops-issue-request-content"><IssueRequestCard key={displayedIssue.id} issue={displayedIssue} canWrite={canWrite} actorName={actorName} onUpdate={onUpdate} onArchive={onArchive} showProject onUpdated={(updated) => { setCurrent(updated); onUpdated?.(updated); }} onArchived={(archived) => { onArchived?.(archived); onClose(); }} /></div></article></div>;
}

function MeetingComposeModal({ projects, initialDate, onClose, onSave }) {
  const [meetingDate, setMeetingDate] = useState(initialDate || localDate());
  const [entries, setEntries] = useState(() => Object.fromEntries(projects.map((project) => [project.id, {
    title: "데일리 운영 회의",
    discussion: "",
    decisions: "",
    actionItems: "",
  }])));
  const [savedProjectIds, setSavedProjectIds] = useState([]);
  const [saveProgress, setSaveProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const hasContent = (entry) => [entry?.discussion, entry?.decisions, entry?.actionItems].some((value) => String(value || "").trim());
  const readyProjects = projects.filter((project) => hasContent(entries[project.id]) && !savedProjectIds.includes(project.id));
  const updateEntry = (projectId, key) => (event) => {
    const { value } = event.target;
    setEntries((current) => ({ ...current, [projectId]: { ...current[projectId], [key]: value } }));
  };
  const submit = async (event) => {
    event.preventDefault();
    if (!meetingDate) return setError("회의 날짜를 확인해 주세요.");
    if (!readyProjects.length) return setError("한 개 이상의 프로젝트에 회의내용, 결정사항 또는 후속업무를 입력해 주세요.");
    setSaving(true);
    setError("");
    setSaveProgress({ current: 0, total: readyProjects.length });
    let savedCount = 0;
    try {
      for (const project of readyProjects) {
        const entry = entries[project.id];
        const title = entry.title.trim() || "데일리 운영 회의";
        const savedTitle = project.isMisc ? `${MISC_PREFIX} ${title.replace(/^\[기타\]\s*/, "")}` : title;
        await onSave(null, {
          meeting_date: meetingDate,
          title: savedTitle,
          attendees_text: "",
          discussion_text: entry.discussion.trim(),
          decisions_text: entry.decisions.trim(),
          action_items_text: entry.actionItems.trim(),
          visibility_code: "PROJECT_TEAM",
        }, project.saveProjectId || project.id);
        savedCount += 1;
        setSavedProjectIds((current) => [...current, project.id]);
        setSaveProgress({ current: savedCount, total: readyProjects.length });
      }
      onClose();
    } catch (saveError) {
      const prefix = savedCount ? `${savedCount}개 프로젝트는 저장됐습니다. ` : "";
      setError(`${prefix}${saveError?.message || "나머지 회의록을 저장하지 못했습니다."}`);
      setSaving(false);
    }
  };
  return <div className="ops-modal-backdrop" role="presentation" onMouseDown={onClose}><form className="ops-modal ops-compose-modal is-multi-project" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}><header><div><span className="ops-panel-icon"><Clock3 size={17} /></span><div><small>내용이 입력된 프로젝트만 저장됩니다.</small><h2>프로젝트별 회의내용 추가</h2></div></div><button type="button" aria-label="닫기" onClick={onClose}><X size={19} /></button></header><div className="ops-compose-overview"><label><span>공통 회의 날짜</span><input type="date" value={meetingDate} onChange={(event) => setMeetingDate(event.target.value)} /></label><p>프로젝트를 전환하지 않고 각 업체 내용을 한 화면에서 작성할 수 있습니다.</p></div><div className="ops-compose-projects" aria-label="프로젝트별 회의내용 입력">{projects.map((project) => { const entry = entries[project.id]; const saved = savedProjectIds.includes(project.id); const filled = hasContent(entry); return <section className={`ops-compose-project-card${filled ? " is-filled" : ""}${saved ? " is-saved" : ""}`} key={project.id}><header><span>{project.clientName.slice(0, 1)}</span><div><strong>{project.clientName}</strong><small>{project.name}</small></div>{saved && <em><CheckCircle2 size={13} /> 저장 완료</em>}</header><label><span>회의 제목</span><input value={entry.title} disabled={saved} onChange={updateEntry(project.id, "title")} /></label><label><span>회의내용</span><textarea rows="4" value={entry.discussion} disabled={saved} onChange={updateEntry(project.id, "discussion")} placeholder="논의한 내용을 항목별로 입력" /></label><label><span>결정사항</span><textarea rows="3" value={entry.decisions} disabled={saved} onChange={updateEntry(project.id, "decisions")} placeholder="확정된 사항을 입력" /></label><label><span>후속업무</span><textarea rows="3" value={entry.actionItems} disabled={saved} onChange={updateEntry(project.id, "actionItems")} placeholder="담당자가 실행할 업무를 입력" /></label></section>; })}</div>{error && <p className="ops-form-error ops-compose-error" role="alert">{error}</p>}<footer><span className="ops-compose-ready">{readyProjects.length ? `${readyProjects.length}개 프로젝트 입력됨` : "입력 대기"}</span><button className="ops-secondary" type="button" disabled={saving} onClick={onClose}>취소</button><button className="ops-primary" type="submit" disabled={saving || !readyProjects.length}>{saving ? `저장 중 ${saveProgress.current}/${saveProgress.total}` : `${readyProjects.length || 0}개 프로젝트 저장`}</button></footer></form></div>;
}

function DateNavigator({ selectedDate, onChange, loading = false }) {
  const activeDate = weekdayDate(selectedDate);
  const week = workWeek(activeDate);
  const dates = Array.from({ length: 5 }, (_, index) => moveDate(week.from, index));
  const selectDate = (date) => onChange(weekdayDate(date));
  return <div className="ops-meeting-date-nav"><div className="ops-date-nav-actions"><div className="ops-week-switcher ops-meeting-week-switcher"><button type="button" aria-label="이전 주차" disabled={loading} onClick={() => selectDate(moveDate(week.from, -7))}>«</button><span><strong>{weekLabel(week.from)}</strong><small>{shortDate(week.from)} – {shortDate(week.to)}</small></span><button type="button" aria-label="다음 주차" disabled={loading} onClick={() => selectDate(moveDate(week.from, 7))}>»</button></div><div className="ops-date-quick-actions"><button type="button" disabled={loading} onClick={() => selectDate(localDate())}>이번 주</button><label className="ops-calendar-jump"><CalendarDays size={17} /><span>날짜 선택</span><input type="date" value={activeDate} disabled={loading} onChange={(event) => event.target.value && selectDate(event.target.value)} /></label></div></div><div className="ops-recent-dates">{dates.map((date) => <button type="button" className={date === activeDate ? "is-active" : ""} aria-pressed={date === activeDate} disabled={loading} key={date} onClick={() => selectDate(date)}><small>{parseDate(date).toLocaleDateString("ko-KR", { weekday: "long" })}</small><strong>{shortDate(date)}</strong></button>)}</div></div>;
}

export function WorkspaceDailyMeetingsView({ dashboard, canWrite, onSave, onLoadWeek }) {
  const [selectedDate, setSelectedDate] = useState(() => weekdayDate(localDate())); const [composeOpen, setComposeOpen] = useState(false);
  const [loadedWeek, setLoadedWeek] = useState(null); const [weekLoading, setWeekLoading] = useState(false); const [weekError, setWeekError] = useState("");
  const selectedWeek = workWeek(selectedDate);
  const withinInitialRange = selectedWeek.from >= dashboard.range.from && selectedWeek.to <= dashboard.range.to;
  const meetingSource = withinInitialRange ? dashboard.meetings : loadedWeek?.from === selectedWeek.from ? loadedWeek.meetings : [];
  const meetings = meetingSource.filter((meeting) => meeting.date === selectedDate);
  const pocketProject = dashboard.projects.find((project) => project.clientName === "포켓컴퍼니" || project.name.includes("포켓컴퍼니"));
  const miscProject = pocketProject ? { id: "misc", saveProjectId: pocketProject.id, clientName: "기타", name: "프로젝트 외 공통·별도 안건", isMisc: true } : null;
  const displayProjects = dashboard.projects.flatMap((project) => project.id === pocketProject?.id && miscProject ? [project, miscProject] : [project]);
  const composeProjects = miscProject ? displayProjects : dashboard.projects;
  const grouped = displayProjects.map((project) => ({
    project,
    meetings: meetings.filter((meeting) => project.isMisc
      ? meeting.projectId === project.saveProjectId && isMiscMeeting(meeting)
      : meeting.projectId === project.id && !(project.id === pocketProject?.id && isMiscMeeting(meeting))),
  }));
  const selectDate = async (date) => {
    const nextDate = weekdayDate(date); const nextWeek = workWeek(nextDate); setSelectedDate(nextDate); setWeekError("");
    if (nextWeek.from >= dashboard.range.from && nextWeek.to <= dashboard.range.to) return;
    if (loadedWeek?.from === nextWeek.from) return;
    setWeekLoading(true);
    try { const result = await onLoadWeek(nextWeek.from, nextWeek.to); setLoadedWeek({ from: nextWeek.from, meetings: result.meetings || [] }); }
    catch (error) { setLoadedWeek({ from: nextWeek.from, meetings: [] }); setWeekError(error?.message || "회의록을 불러오지 못했습니다."); }
    finally { setWeekLoading(false); }
  };
  return <div className="operations-dashboard ops-workspace-daily"><header className="ops-daily-hero"><div><span className="ops-eyebrow">전체 업체</span><h1>데일리 회의록</h1><p>기록을 쌓는 데서 끝내지 않고, 이번 주 결정과 후속업무를 계속 확인합니다.</p></div>{canWrite && <button className="ops-primary" type="button" onClick={() => setComposeOpen(true)}><Plus size={16} /> 회의내용 추가</button>}</header><DateNavigator selectedDate={selectedDate} loading={weekLoading} onChange={(date) => void selectDate(date)} />{weekError && <p className="ops-week-error" role="alert">{weekError}</p>}<WeeklyMeetingFocus meetings={meetingSource.filter((meeting) => meeting.date >= selectedWeek.from && meeting.date <= selectedWeek.to)} issues={dashboard.issues || []} week={selectedWeek} />{weekLoading ? <div className="ops-panel ops-inline-empty">선택한 주차의 회의록을 불러오는 중입니다.</div> : <section className="ops-daily-company-list">{grouped.map(({ project, meetings: projectMeetings }) => <article className={`ops-panel ops-daily-company${project.isMisc ? " is-misc" : ""}`} key={project.id}><header><div><span className="ops-company-mark">{project.isMisc ? "+" : project.clientName.slice(0, 1)}</span><div><h2>{project.clientName}</h2><p>{project.name}</p></div></div><b>{projectMeetings.length}건</b></header>{projectMeetings.length ? <div className="ops-meeting-list">{projectMeetings.map((meeting) => <details className="ops-daily-record" key={meeting.id} open><summary><span>{shortDate(meeting.date)}</span><strong>{visibleMeetingTitle(meeting)}</strong><small>{meeting.authorName}</small><ChevronDown size={17} /></summary><MeetingBody meeting={meeting} /></details>)}</div> : <div className="ops-inline-empty">선택한 날짜에 등록된 회의가 없습니다.</div>}</article>)}</section>}{composeOpen && <MeetingComposeModal projects={composeProjects} initialDate={selectedDate} onSave={onSave} onClose={() => setComposeOpen(false)} />}</div>;
}

export function OperationsDashboardView({ dashboard, canWrite, actorName, onIssueCreate, onIssueUpdate, onIssueArchive, onOpenProject, onLoadWeek, onResolveTaskLink }) {
  const [projectFilter, setProjectFilter] = useState("all"); const [meetingDate, setMeetingDate] = useState(() => dashboard.meetings[0]?.date || localDate()); const [issue, setIssue] = useState(null);
  const [issueOverrides, setIssueOverrides] = useState({});
  const [createdIssues, setCreatedIssues] = useState([]); const [archivedIssueIds, setArchivedIssueIds] = useState(() => new Set()); const [issueFilter, setIssueFilter] = useState("open"); const [issueComposeOpen, setIssueComposeOpen] = useState(false);
  const [selectedWeek, setSelectedWeek] = useState(() => workWeek()); const [loadedWeek, setLoadedWeek] = useState(null); const [weekLoading, setWeekLoading] = useState(false); const [weekError, setWeekError] = useState("");
  const visibleProjects = projectFilter === "all" ? dashboard.projects : dashboard.projects.filter((item) => item.id === projectFilter);
  const effectiveIssues = useMemo(() => [...createdIssues, ...dashboard.issues].filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index && !archivedIssueIds.has(item.id)).map((item) => issueOverrides[item.id] || item), [dashboard.issues, createdIssues, archivedIssueIds, issueOverrides]);
  const filteredIssues = newestIssuesFirst(effectiveIssues.filter((item) => (issueFilter === "done" ? ["DONE", "CLOSED", "COMPLETED"].includes(item.statusCode) : !["DONE", "CLOSED", "COMPLETED"].includes(item.statusCode)) && (projectFilter === "all" || item.projectId === projectFilter)));
  const meetingDates = [...new Set(dashboard.meetings.filter((item) => projectFilter === "all" || item.projectId === projectFilter).map((item) => item.date))].slice(0, 7);
  const effectiveMeetingDate = meetingDates.includes(meetingDate) ? meetingDate : meetingDates[0] || meetingDate;
  const filteredMeetings = dashboard.meetings.filter((item) => (projectFilter === "all" || item.projectId === projectFilter) && item.date === effectiveMeetingDate);
  const weekSource = loadedWeek?.from === selectedWeek.from ? loadedWeek.tasks : dashboard.weeklyTasks;
  const deadlineTasks = weekSource.filter((task) => (projectFilter === "all" || task.projectId === projectFilter) && task.dueDate >= selectedWeek.from && task.dueDate <= selectedWeek.to);
  const groupedTasks = visibleProjects.map((project) => ({ project, tasks: deadlineTasks.filter((task) => task.projectId === project.id) })).filter((group) => group.tasks.length);
  const totals = visibleProjects.reduce((sum, project) => ({ total: sum.total + project.totalTasks, active: sum.active + project.inProgressTasks, hold: sum.hold + project.onHoldTasks, overdue: sum.overdue + project.overdueTasks }), { total: 0, active: 0, hold: 0, overdue: 0 });
  const moveWeek = async (direction) => { const next = workWeek(moveDate(selectedWeek.from, direction * 7)); setSelectedWeek(next); setWeekError(""); setWeekLoading(true); try { const result = await onLoadWeek(next.from, next.to); setLoadedWeek({ from: next.from, tasks: result.weeklyTasks || [] }); } catch (error) { setLoadedWeek({ from: next.from, tasks: [] }); setWeekError(error?.message || "주간 업무를 불러오지 못했습니다."); } finally { setWeekLoading(false); } };
  return <div className="operations-dashboard"><header className="ops-hero"><div><span className="ops-eyebrow">전체 프로젝트 운영 현황</span><h1>통합 관리</h1><p>지난 회의, 확인 요청, 마감 업무 순서로 오늘의 판단 대상을 확인합니다.</p></div><div className="ops-range"><CalendarDays size={18} /><span>조회 범위</span><strong>{shortDate(dashboard.range.from)} — {shortDate(dashboard.range.to)}</strong></div></header><ProjectTabs projects={dashboard.projects} value={projectFilter} onChange={setProjectFilter} /><section className="ops-summary-grid" aria-label="통합 요약"><article><span>전체 업무</span><strong>{totals.total}</strong><small>등록된 업무</small></article><article><span>진행 중</span><strong>{totals.active}</strong><small>현재 실행 중</small></article><article className={totals.hold ? "is-warning" : ""}><span>보류</span><strong>{totals.hold}</strong><small>재확인 필요</small></article><article className={totals.overdue ? "is-danger" : ""}><span>기한 초과</span><strong>{totals.overdue}</strong><small>일정 조정 필요</small></article></section>
    <section className="ops-priority-grid"><article className="ops-panel ops-meeting-panel"><header><div><span className="ops-panel-icon"><Clock3 size={17} /></span><div><h2>지난 회의 내용</h2><p>오늘 회의에서 이어서 확인할 내용</p></div></div><button type="button" onClick={() => onOpenProject(filteredMeetings[0]?.projectId || visibleProjects[0]?.id, "daily")}>회의록 열기 <ArrowRight size={14} /></button></header>{meetingDates.length > 0 && <div className="ops-date-tabs">{meetingDates.map((date) => <button type="button" key={date} className={effectiveMeetingDate === date ? "is-active" : ""} onClick={() => setMeetingDate(date)}>{shortDate(date)}</button>)}</div>}{filteredMeetings.length ? <div className="ops-meeting-list">{filteredMeetings.map((meeting) => <details key={meeting.id} open><summary><span>{meeting.clientName}</span><strong>{meeting.title}</strong><ChevronDown size={15} /></summary><MeetingBody meeting={meeting} /></details>)}</div> : <div className="ops-empty"><Clock3 size={22} /><strong>선택한 날짜의 회의록이 없습니다</strong></div>}</article><article className="ops-panel ops-issue-panel"><header><div><span className="ops-panel-icon is-alert"><AlertCircle size={17} /></span><div><h2>확인 요청</h2><p>답변이나 승인이 필요한 항목</p></div></div>{canWrite && <button type="button" className="ops-issue-create" onClick={() => setIssueComposeOpen(true)}><Plus size={14} />추가</button>}</header><div className="ops-issue-tabs"><button type="button" className={issueFilter === "open" ? "is-active" : ""} onClick={() => setIssueFilter("open")}>확인 요청 <b>{effectiveIssues.filter((item) => !["DONE", "CLOSED", "COMPLETED"].includes(item.statusCode) && (projectFilter === "all" || item.projectId === projectFilter)).length}</b></button><button type="button" className={issueFilter === "done" ? "is-active" : ""} onClick={() => setIssueFilter("done")}>확인 완료 <b>{effectiveIssues.filter((item) => ["DONE", "CLOSED", "COMPLETED"].includes(item.statusCode) && (projectFilter === "all" || item.projectId === projectFilter)).length}</b></button></div>{filteredIssues.length ? <div className="ops-issue-list">{filteredIssues.slice(0, 12).map((item) => <button type="button" key={item.id} onClick={() => setIssue(item)}><span className="ops-project-dot" /><span className="ops-issue-meta"><small>{item.clientName} · {item.projectName}</small><strong>{item.relatedTask || item.body || "내용 미등록"}</strong><em>남긴 사람 {item.requester || "확인되지 않은 사용자"} · 작성 {requestCreatedLabel(item.createdAt, item.date)}</em></span><span className="ops-issue-body">{item.body || "내용 미등록"}</span><time className={item.dueDate && item.dueDate < localDate() ? "is-overdue" : ""}>{item.dueDate ? `마감 ${shortDate(item.dueDate)}` : "마감 미정"}</time></button>)}</div> : <div className="ops-empty"><CheckCircle2 size={22} /><strong>{issueFilter === "done" ? "완료된 확인 요청이 없습니다" : "대기 중인 확인 요청이 없습니다"}</strong></div>}</article></section>
    <section className="ops-panel ops-weekly-panel"><header><div><h2>마감 업무 체크</h2><p>마감일 기준 완료 여부 · 빨간 ▲는 오늘 상승한 진행률(%p), 한국시간 자정 기준입니다.</p></div><div className="ops-week-switcher"><button type="button" aria-label="이전 주차" disabled={weekLoading} onClick={() => void moveWeek(-1)}>«</button><span><strong>{weekLabel(selectedWeek.from)}</strong><small>{shortDate(selectedWeek.from)} – {shortDate(selectedWeek.to)}</small></span><button type="button" aria-label="다음 주차" disabled={weekLoading} onClick={() => void moveWeek(1)}>»</button></div></header>{weekError && <p className="ops-week-error" role="alert">{weekError}</p>}{weekLoading ? <div className="ops-inline-empty">주간 업무를 불러오는 중입니다.</div> : groupedTasks.length ? <div className="ops-project-worklist">{groupedTasks.map(({ project, tasks }) => <article key={project.id}><header><div><strong>{project.clientName}</strong><span>{project.name}</span></div><button type="button" onClick={() => onOpenProject(project.id, "schedule")}>업무 열기 <ArrowRight size={13} /></button></header><div className="ops-task-table"><div className="ops-task-row is-head"><span>업무</span><span>상태</span><span>진행률</span><span>마감</span><span>완료링크</span></div>{tasks.map((task) => <div className="ops-task-row" key={task.id}><span><strong>{task.title}</strong><small>{task.description || task.workstreamCode}</small></span><span><StatusBadge code={task.statusCode} /></span><span className="ops-progress"><i><b style={{ width: `${task.progressPercent}%` }} /></i><span className="ops-progress-reading"><strong>{task.progressPercent}%</strong>{task.progressDeltaToday > 0 && <small className="ops-progress-delta" title={`오늘 상승 ${task.progressDeltaToday}%p · 한국시간 자정에 기준 초기화`} aria-label={`전일 대비 ${task.progressDeltaToday}퍼센트포인트 상승`}>▲ +{task.progressDeltaToday}%p</small>}{task.progressDeltaToday == null && <small className="ops-progress-unavailable" title="서버에서 진행률 비교 데이터를 받지 못했습니다.">비교값 없음</small>}</span></span><time>{shortDate(task.dueDate)}</time><span><DeadlineTaskLink task={task} onResolve={onResolveTaskLink}/></span></div>)}</div></article>)}</div> : <div className="ops-inline-empty">{weekLabel(selectedWeek.from)}에 마감되는 업무가 없습니다.</div>}</section>
    <section className="ops-panel"><header><div><h2>프로젝트 상태</h2><p>전체 업무 기준 진행률과 위험 신호</p></div></header><div className="ops-health-grid">{visibleProjects.map((project) => { const progress = project.totalTasks ? Math.round(project.doneTasks / project.totalTasks * 100) : 0; return <button type="button" key={project.id} onClick={() => onOpenProject(project.id, "schedule")}><span><strong>{project.clientName}</strong><small>{project.name}</small></span><span className="ops-health-numbers"><b>{progress}%</b><small>{project.doneTasks}/{project.totalTasks} 완료</small></span><span className="ops-health-bar"><b style={{ width: `${progress}%` }} /></span>{(project.onHoldTasks > 0 || project.overdueTasks > 0) && <span className="ops-health-signal"><CircleDot size={11} />보류 {project.onHoldTasks} · 기한 초과 {project.overdueTasks}</span>}</button>; })}</div></section><IssueDetailModal issue={issue} canWrite={canWrite} actorName={actorName} onUpdate={onIssueUpdate} onArchive={onIssueArchive} onUpdated={(updated) => { setIssue(updated); setIssueOverrides((current) => ({ ...current, [updated.id]: updated })); }} onArchived={(archived) => setArchivedIssueIds((current) => new Set([...current, archived.id]))} onClose={() => setIssue(null)} />{issueComposeOpen && <IssueRequestCreateModal projects={dashboard.projects} initialProjectId={projectFilter === "all" ? dashboard.projects[0]?.id : projectFilter} owners={[...new Set([...dashboard.projects.map((project) => project.clientName), "포켓컴퍼니", "NS"])]} actorName={actorName} onCreate={async (fields, projectId) => { const saved = await onIssueCreate(fields, projectId); const project = dashboard.projects.find((item) => item.id === String(projectId)); setCreatedIssues((current) => [{ ...saved, projectId: String(projectId), clientName: project?.clientName, projectName: project?.name }, ...current]); setIssueFilter("open"); }} onClose={() => setIssueComposeOpen(false)} />}</div>;
}
