import { useState } from "react";
import { AlertCircle, ArrowRight, CalendarDays, CheckCircle2, ChevronDown, CircleDot, Clock3, FolderKanban, Plus, X } from "lucide-react";
import "./operationsDashboard.css";
import "./operationsDashboardEnhancements.css";

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

function IssueDetailModal({ issue, issues, onClose }) {
  if (!issue) return null;
  return <div className="ops-modal-backdrop" role="presentation" onMouseDown={onClose}><article className="ops-modal ops-issue-ledger-modal" role="dialog" aria-modal="true" aria-label="확인 요청 상세" onMouseDown={(event) => event.stopPropagation()}><header><div><span className="ops-panel-icon is-alert"><AlertCircle size={17} /></span><div><small>확인 요청 {issues.length}건 · 선택 항목 강조</small><h2>이슈사항 · 추가요청 기록</h2></div></div><button type="button" aria-label="닫기" onClick={onClose}><X size={19} /></button></header><div className="ops-issue-ledger-scroll"><table><thead><tr><th>No</th><th>업체</th><th>등록일 · 컨펌 마감일</th><th>구분</th><th>관련 업무</th><th>내용</th><th>담당자</th><th>상태</th><th>완료링크</th><th>비고</th></tr></thead><tbody>{issues.map((item, index) => <tr className={item.id === issue.id ? "is-selected" : ""} key={item.id}><td>{index + 1}</td><td><strong>{item.clientName}</strong><span>{item.projectName}</span></td><td><strong>{item.date || "미정"}</strong><span>→ {item.dueDate || "미정"}</span></td><td>{item.kind}</td><td>{item.relatedTask || "—"}</td><td>{item.body || "—"}</td><td>{item.owner || "미지정"}</td><td><StatusBadge code={item.statusCode} /></td><td>{item.completionUrl ? <a href={item.completionUrl} target="_blank" rel="noreferrer">열기 ↗</a> : "—"}</td><td>{item.remarks || "—"}</td></tr>)}</tbody></table></div><footer><button className="ops-primary" type="button" onClick={onClose}>확인</button></footer></article></div>;
}

function MeetingComposeModal({ projects, initialDate, onClose, onSave }) {
  const [projectId, setProjectId] = useState(projects[0]?.id || "");
  const [fields, setFields] = useState({ date: initialDate || localDate(), title: "데일리 운영 회의", attendees: "", discussion: "", decisions: "", actionItems: "" });
  const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const update = (key) => (event) => setFields((current) => ({ ...current, [key]: event.target.value }));
  const submit = async (event) => { event.preventDefault(); if (!projectId || !fields.date || !fields.title.trim()) return setError("프로젝트, 날짜, 제목을 확인해 주세요."); const selectedProject = projects.find((project) => project.id === projectId); const targetProjectId = selectedProject?.saveProjectId || projectId; const savedTitle = selectedProject?.isMisc ? `${MISC_PREFIX} ${fields.title.trim().replace(/^\[기타\]\s*/, "")}` : fields.title.trim(); setSaving(true); setError(""); try { await onSave(null, { meeting_date: fields.date, title: savedTitle, attendees_text: fields.attendees.trim(), discussion_text: fields.discussion.trim(), decisions_text: fields.decisions.trim(), action_items_text: fields.actionItems.trim(), visibility_code: "PROJECT_TEAM" }, targetProjectId); onClose(); } catch (saveError) { setError(saveError?.message || "회의록을 저장하지 못했습니다."); setSaving(false); } };
  return <div className="ops-modal-backdrop" role="presentation" onMouseDown={onClose}><form className="ops-modal ops-compose-modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}><header><div><span className="ops-panel-icon"><Clock3 size={17} /></span><div><small>전체 업체 회의 기록</small><h2>회의내용 추가</h2></div></div><button type="button" aria-label="닫기" onClick={onClose}><X size={19} /></button></header><div className="ops-modal-content ops-compose-grid"><label><span>프로젝트</span><select value={projectId} onChange={(event) => setProjectId(event.target.value)}>{projects.map((project) => <option key={project.id} value={project.id}>{project.clientName} · {project.name}</option>)}</select></label><label><span>회의 날짜</span><input type="date" value={fields.date} onChange={update("date")} /></label><label className="is-wide"><span>회의 제목</span><input value={fields.title} onChange={update("title")} /></label><label className="is-wide"><span>참석자</span><input value={fields.attendees} onChange={update("attendees")} placeholder="쉼표로 구분" /></label><label className="is-wide"><span>회의내용</span><textarea rows="4" value={fields.discussion} onChange={update("discussion")} placeholder="논의한 내용을 항목별로 입력" /></label><label><span>결정사항</span><textarea rows="4" value={fields.decisions} onChange={update("decisions")} /></label><label><span>후속업무</span><textarea rows="4" value={fields.actionItems} onChange={update("actionItems")} /></label>{error && <p className="ops-form-error">{error}</p>}</div><footer><button className="ops-secondary" type="button" onClick={onClose}>취소</button><button className="ops-primary" type="submit" disabled={saving}>{saving ? "저장 중" : "회의록 저장"}</button></footer></form></div>;
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

export function OperationsDashboardView({ dashboard, onOpenProject, onLoadWeek }) {
  const [projectFilter, setProjectFilter] = useState("all"); const [meetingDate, setMeetingDate] = useState(() => dashboard.meetings[0]?.date || localDate()); const [issue, setIssue] = useState(null);
  const [selectedWeek, setSelectedWeek] = useState(() => workWeek()); const [loadedWeek, setLoadedWeek] = useState(null); const [weekLoading, setWeekLoading] = useState(false); const [weekError, setWeekError] = useState("");
  const visibleProjects = projectFilter === "all" ? dashboard.projects : dashboard.projects.filter((item) => item.id === projectFilter);
  const filteredIssues = dashboard.issues.filter((item) => projectFilter === "all" || item.projectId === projectFilter);
  const meetingDates = [...new Set(dashboard.meetings.filter((item) => projectFilter === "all" || item.projectId === projectFilter).map((item) => item.date))].slice(0, 7);
  const effectiveMeetingDate = meetingDates.includes(meetingDate) ? meetingDate : meetingDates[0] || meetingDate;
  const filteredMeetings = dashboard.meetings.filter((item) => (projectFilter === "all" || item.projectId === projectFilter) && item.date === effectiveMeetingDate);
  const weekSource = loadedWeek?.from === selectedWeek.from ? loadedWeek.tasks : dashboard.weeklyTasks;
  const deadlineTasks = weekSource.filter((task) => (projectFilter === "all" || task.projectId === projectFilter) && task.dueDate >= selectedWeek.from && task.dueDate <= selectedWeek.to);
  const groupedTasks = visibleProjects.map((project) => ({ project, tasks: deadlineTasks.filter((task) => task.projectId === project.id) })).filter((group) => group.tasks.length);
  const totals = visibleProjects.reduce((sum, project) => ({ total: sum.total + project.totalTasks, active: sum.active + project.inProgressTasks, hold: sum.hold + project.onHoldTasks, overdue: sum.overdue + project.overdueTasks }), { total: 0, active: 0, hold: 0, overdue: 0 });
  const moveWeek = async (direction) => { const next = workWeek(moveDate(selectedWeek.from, direction * 7)); setSelectedWeek(next); setWeekError(""); setWeekLoading(true); try { const result = await onLoadWeek(next.from, next.to); setLoadedWeek({ from: next.from, tasks: result.weeklyTasks || [] }); } catch (error) { setLoadedWeek({ from: next.from, tasks: [] }); setWeekError(error?.message || "주간 업무를 불러오지 못했습니다."); } finally { setWeekLoading(false); } };
  return <div className="operations-dashboard"><header className="ops-hero"><div><span className="ops-eyebrow">전체 프로젝트 운영 현황</span><h1>통합 관리</h1><p>지난 회의, 확인 요청, 마감 업무 순서로 오늘의 판단 대상을 확인합니다.</p></div><div className="ops-range"><CalendarDays size={18} /><span>조회 범위</span><strong>{shortDate(dashboard.range.from)} — {shortDate(dashboard.range.to)}</strong></div></header><ProjectTabs projects={dashboard.projects} value={projectFilter} onChange={setProjectFilter} /><section className="ops-summary-grid" aria-label="통합 요약"><article><span>전체 업무</span><strong>{totals.total}</strong><small>등록된 업무</small></article><article><span>진행 중</span><strong>{totals.active}</strong><small>현재 실행 중</small></article><article className={totals.hold ? "is-warning" : ""}><span>보류</span><strong>{totals.hold}</strong><small>재확인 필요</small></article><article className={totals.overdue ? "is-danger" : ""}><span>기한 초과</span><strong>{totals.overdue}</strong><small>일정 조정 필요</small></article></section>
    <section className="ops-priority-grid"><article className="ops-panel ops-meeting-panel"><header><div><span className="ops-panel-icon"><Clock3 size={17} /></span><div><h2>지난 회의 내용</h2><p>오늘 회의에서 이어서 확인할 내용</p></div></div><button type="button" onClick={() => onOpenProject(filteredMeetings[0]?.projectId || visibleProjects[0]?.id, "daily")}>회의록 열기 <ArrowRight size={14} /></button></header>{meetingDates.length > 0 && <div className="ops-date-tabs">{meetingDates.map((date) => <button type="button" key={date} className={effectiveMeetingDate === date ? "is-active" : ""} onClick={() => setMeetingDate(date)}>{shortDate(date)}</button>)}</div>}{filteredMeetings.length ? <div className="ops-meeting-list">{filteredMeetings.map((meeting) => <details key={meeting.id} open><summary><span>{meeting.clientName}</span><strong>{meeting.title}</strong><ChevronDown size={15} /></summary><MeetingBody meeting={meeting} /></details>)}</div> : <div className="ops-empty"><Clock3 size={22} /><strong>선택한 날짜의 회의록이 없습니다</strong></div>}</article><article className="ops-panel ops-issue-panel"><header><div><span className="ops-panel-icon is-alert"><AlertCircle size={17} /></span><div><h2>확인 요청</h2><p>답변이나 승인이 필요한 항목</p></div></div><b>{filteredIssues.length}건</b></header>{filteredIssues.length ? <div className="ops-issue-list">{filteredIssues.slice(0, 8).map((item) => <button type="button" key={item.id} onClick={() => setIssue(item)}><span className="ops-project-dot" /><span><small>{item.clientName} · {item.kind}</small><strong>{item.body || item.relatedTask || "내용 미등록"}</strong></span><time className={item.dueDate && item.dueDate < localDate() ? "is-overdue" : ""}>{item.dueDate ? `마감 ${shortDate(item.dueDate)}` : "마감 미정"}</time></button>)}</div> : <div className="ops-empty"><CheckCircle2 size={22} /><strong>대기 중인 확인 요청이 없습니다</strong></div>}</article></section>
    <section className="ops-panel ops-weekly-panel"><header><div><h2>마감 업무 체크</h2><p>마감일 기준으로 프로젝트별 완료 여부를 확인합니다.</p></div><div className="ops-week-switcher"><button type="button" aria-label="이전 주차" disabled={weekLoading} onClick={() => void moveWeek(-1)}>«</button><span><strong>{weekLabel(selectedWeek.from)}</strong><small>{shortDate(selectedWeek.from)} – {shortDate(selectedWeek.to)}</small></span><button type="button" aria-label="다음 주차" disabled={weekLoading} onClick={() => void moveWeek(1)}>»</button></div></header>{weekError && <p className="ops-week-error" role="alert">{weekError}</p>}{weekLoading ? <div className="ops-inline-empty">주간 업무를 불러오는 중입니다.</div> : groupedTasks.length ? <div className="ops-project-worklist">{groupedTasks.map(({ project, tasks }) => <article key={project.id}><header><div><strong>{project.clientName}</strong><span>{project.name}</span></div><button type="button" onClick={() => onOpenProject(project.id, "schedule")}>업무 열기 <ArrowRight size={13} /></button></header><div className="ops-task-table"><div className="ops-task-row is-head"><span>업무</span><span>상태</span><span>진행률</span><span>마감</span></div>{tasks.map((task) => <div className="ops-task-row" key={task.id}><span><strong>{task.title}</strong><small>{task.description || task.workstreamCode}</small></span><span><StatusBadge code={task.statusCode} /></span><span className="ops-progress"><i><b style={{ width: `${task.progressPercent}%` }} /></i>{task.progressPercent}%</span><time>{shortDate(task.dueDate)}</time></div>)}</div></article>)}</div> : <div className="ops-inline-empty">{weekLabel(selectedWeek.from)}에 마감되는 업무가 없습니다.</div>}</section>
    <section className="ops-panel"><header><div><h2>프로젝트 상태</h2><p>전체 업무 기준 진행률과 위험 신호</p></div></header><div className="ops-health-grid">{visibleProjects.map((project) => { const progress = project.totalTasks ? Math.round(project.doneTasks / project.totalTasks * 100) : 0; return <button type="button" key={project.id} onClick={() => onOpenProject(project.id, "schedule")}><span><strong>{project.clientName}</strong><small>{project.name}</small></span><span className="ops-health-numbers"><b>{progress}%</b><small>{project.doneTasks}/{project.totalTasks} 완료</small></span><span className="ops-health-bar"><b style={{ width: `${progress}%` }} /></span>{(project.onHoldTasks > 0 || project.overdueTasks > 0) && <span className="ops-health-signal"><CircleDot size={11} />보류 {project.onHoldTasks} · 기한 초과 {project.overdueTasks}</span>}</button>; })}</div></section><IssueDetailModal issue={issue} issues={filteredIssues} onClose={() => setIssue(null)} /></div>;
}
