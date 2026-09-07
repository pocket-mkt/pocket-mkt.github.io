import { useMemo, useState } from "react";
import { AlertCircle, ArrowRight, CalendarDays, CheckCircle2, ChevronDown, CircleDot, Clock3, FolderKanban } from "lucide-react";
import "./operationsDashboard.css";

const STATUS = {
  NOT_STARTED: ["미착수", "muted"],
  IN_PROGRESS: ["진행", "active"],
  DONE: ["완료", "done"],
  ON_HOLD: ["보류", "hold"],
  BLOCKED: ["보류", "hold"],
};

function shortDate(value) {
  if (!value) return "일정 없음";
  const [, month, day] = String(value).split("-");
  return `${Number(month)}.${Number(day)}`;
}

function StatusBadge({ code }) {
  const [label, tone] = STATUS[code] || [code || "미착수", "muted"];
  return <span className={`ops-status is-${tone}`}>{label}</span>;
}

function splitLines(value) {
  return String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export function OperationsDashboardView({ dashboard, onOpenProject }) {
  const [projectFilter, setProjectFilter] = useState("all");
  const visibleProjects = useMemo(() => projectFilter === "all" ? dashboard.projects : dashboard.projects.filter((item) => item.id === projectFilter), [dashboard.projects, projectFilter]);
  const filteredTasks = useMemo(() => projectFilter === "all" ? dashboard.weeklyTasks : dashboard.weeklyTasks.filter((item) => item.projectId === projectFilter), [dashboard.weeklyTasks, projectFilter]);
  const filteredIssues = useMemo(() => projectFilter === "all" ? dashboard.issues : dashboard.issues.filter((item) => item.projectId === projectFilter), [dashboard.issues, projectFilter]);
  const filteredMeetings = useMemo(() => projectFilter === "all" ? dashboard.meetings : dashboard.meetings.filter((item) => item.projectId === projectFilter), [dashboard.meetings, projectFilter]);
  const meetingDates = [...new Set(filteredMeetings.map((item) => item.date).filter(Boolean))].slice(0, 5);
  const [meetingDateOverride, setMeetingDateOverride] = useState(null);
  const selectedMeetingDate = meetingDates.includes(meetingDateOverride) ? meetingDateOverride : meetingDates[0] || null;
  const selectedMeetings = filteredMeetings.filter((item) => item.date === selectedMeetingDate);
  const groupedTasks = visibleProjects.map((project) => ({ project, tasks: filteredTasks.filter((task) => task.projectId === project.id) })).filter((group) => projectFilter === "all" ? group.tasks.length : true);
  const totals = visibleProjects.reduce((sum, project) => ({
    total: sum.total + project.totalTasks,
    active: sum.active + project.inProgressTasks,
    hold: sum.hold + project.onHoldTasks,
    overdue: sum.overdue + project.overdueTasks,
  }), { total: 0, active: 0, hold: 0, overdue: 0 });

  return <div className="operations-dashboard">
    <header className="ops-hero">
      <div><span className="ops-eyebrow">전체 프로젝트 운영 현황</span><h1>통합 관리</h1><p>회의 결정, 확인 요청, 이번 주 실행 업무를 한 화면에서 점검합니다.</p></div>
      <div className="ops-range"><CalendarDays size={18} /><span>이번 주</span><strong>{shortDate(dashboard.range.from)} — {shortDate(dashboard.range.to)}</strong></div>
    </header>

    <nav className="ops-project-tabs" aria-label="프로젝트 필터">
      <button type="button" className={projectFilter === "all" ? "is-active" : ""} onClick={() => setProjectFilter("all")}><FolderKanban size={16} />전체</button>
      {dashboard.projects.map((project) => <button type="button" key={project.id} className={projectFilter === project.id ? "is-active" : ""} onClick={() => setProjectFilter(project.id)}>{project.clientName}<small>{project.inProgressTasks}건 진행</small></button>)}
    </nav>

    <section className="ops-summary-grid" aria-label="통합 요약">
      <article><span>전체 업무</span><strong>{totals.total}</strong><small>등록된 업무</small></article>
      <article><span>진행 중</span><strong>{totals.active}</strong><small>현재 실행 중</small></article>
      <article className={totals.hold ? "is-warning" : ""}><span>보류</span><strong>{totals.hold}</strong><small>재확인 필요</small></article>
      <article className={totals.overdue ? "is-danger" : ""}><span>기한 초과</span><strong>{totals.overdue}</strong><small>일정 조정 필요</small></article>
    </section>

    <section className="ops-priority-grid">
      <article className="ops-panel ops-meeting-panel">
        <header><div><span className="ops-panel-icon"><Clock3 size={17} /></span><div><h2>지난 회의 핵심</h2><p>오늘 회의에서 이어서 확인할 결정과 후속 업무</p></div></div>{selectedMeetingDate && <button type="button" onClick={() => selectedMeetings[0] && onOpenProject(selectedMeetings[0].projectId, "daily")}>회의록 열기 <ArrowRight size={14} /></button>}</header>
        {meetingDates.length > 0 && <div className="ops-date-tabs">{meetingDates.map((date) => <button type="button" key={date} className={selectedMeetingDate === date ? "is-active" : ""} onClick={() => setMeetingDateOverride(date)}>{shortDate(date)}</button>)}</div>}
        {selectedMeetings.length ? <div className="ops-meeting-list">{selectedMeetings.map((meeting) => <details key={meeting.id} open><summary><span>{meeting.clientName}</span><strong>{meeting.title}</strong><ChevronDown size={15} /></summary><div className="ops-meeting-body"><section><h3>결정사항</h3>{splitLines(meeting.decisions).length ? <ul>{splitLines(meeting.decisions).map((line, index) => <li key={index}>{line}</li>)}</ul> : <p>기록된 결정사항이 없습니다.</p>}</section><section><h3>후속업무</h3>{splitLines(meeting.actionItems).length ? <ul>{splitLines(meeting.actionItems).map((line, index) => <li key={index}>{line}</li>)}</ul> : <p>기록된 후속업무가 없습니다.</p>}</section></div></details>)}</div> : <div className="ops-empty"><Clock3 size={22} /><strong>등록된 회의록이 없습니다</strong><span>프로젝트 데일리 회의록에서 회의 내용을 등록해 주세요.</span></div>}
      </article>

      <article className="ops-panel ops-issue-panel">
        <header><div><span className="ops-panel-icon is-alert"><AlertCircle size={17} /></span><div><h2>확인 요청</h2><p>답변이나 승인이 필요한 항목</p></div></div><b>{filteredIssues.length}건</b></header>
        {filteredIssues.length ? <div className="ops-issue-list">{filteredIssues.slice(0, 8).map((issue) => <button type="button" key={issue.id} onClick={() => onOpenProject(issue.projectId, "schedule")}><span className="ops-project-dot" /><span><small>{issue.clientName} · {issue.kind}</small><strong>{issue.body || issue.relatedTask || "내용 미등록"}</strong></span><time className={issue.dueDate && issue.dueDate < new Date().toISOString().slice(0, 10) ? "is-overdue" : ""}>{issue.dueDate ? `마감 ${shortDate(issue.dueDate)}` : "마감 미정"}</time></button>)}</div> : <div className="ops-empty"><CheckCircle2 size={22} /><strong>대기 중인 확인 요청이 없습니다</strong><span>현재 바로 확인할 항목이 없습니다.</span></div>}
      </article>
    </section>

    <section className="ops-panel ops-weekly-panel">
      <header><div><h2>이번 주 진행 업무</h2><p>프로젝트별 일정과 상태를 같은 기준으로 확인합니다.</p></div><span>{filteredTasks.length}건</span></header>
      {groupedTasks.length ? <div className="ops-project-worklist">{groupedTasks.map(({ project, tasks }) => <article key={project.id}>
        <header><div><strong>{project.clientName}</strong><span>{project.name}</span></div><button type="button" onClick={() => onOpenProject(project.id, "schedule")}>업무 열기 <ArrowRight size={13} /></button></header>
        {tasks.length ? <div className="ops-task-table"><div className="ops-task-row is-head"><span>업무</span><span>일정</span><span>진행률</span><span>상태</span></div>{tasks.map((task) => <div className="ops-task-row" key={task.id}><span><strong>{task.title}</strong><small>{task.description}</small></span><time>{shortDate(task.plannedStartDate)} — {shortDate(task.dueDate)}</time><span className="ops-progress"><i><b style={{ width: `${Math.max(0, Math.min(100, task.progressPercent))}%` }} /></i>{task.progressPercent}%</span><StatusBadge code={task.statusCode} /></div>)}</div> : <div className="ops-inline-empty">이번 주에 배정된 업무가 없습니다.</div>}
      </article>)}</div> : <div className="ops-empty"><CalendarDays size={22} /><strong>이번 주 업무가 없습니다</strong><span>선택한 프로젝트와 기간에 겹치는 일정이 없습니다.</span></div>}
    </section>

    <section className="ops-panel ops-project-health">
      <header><div><h2>프로젝트 상태</h2><p>업무량보다 의사결정이 필요한 신호를 우선 표시합니다.</p></div></header>
      <div className="ops-health-grid">{visibleProjects.map((project) => { const rate = project.totalTasks ? Math.round(project.doneTasks / project.totalTasks * 100) : 0; return <button type="button" key={project.id} onClick={() => onOpenProject(project.id, "progress")}><span><strong>{project.clientName}</strong><small>{project.name}</small></span><span className="ops-health-numbers"><b>{rate}%</b><small>{project.doneTasks}/{project.totalTasks} 완료</small></span><i className="ops-health-bar"><b style={{ width: `${rate}%` }} /></i><span className="ops-health-signal">{project.onHoldTasks > 0 ? <><AlertCircle size={14} /> 보류 {project.onHoldTasks}건</> : <><CircleDot size={14} /> 정상 진행</>}</span></button>; })}</div>
    </section>
  </div>;
}
