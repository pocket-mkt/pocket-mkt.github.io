import MeetingText from "./MeetingText.jsx";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, CalendarDays, CheckCircle2, CircleAlert, CircleDot, Plus, RefreshCw, X } from "lucide-react";
import { dailyMeetingsViewModel } from "./api/viewModel.js";
import { isViewAllowed } from "./accessPermissions.js";
import IssueRequestCard from "./IssueRequestCard.jsx";
import IssueRequestCreateModal from "./IssueRequestCreateModal.jsx";
import { latestBriefMeeting, progressBriefTasks } from "./progressBrief.js";
import "./progressView.css";
import { DeferredSchedule, TaskColumn } from "./ProgressFlow.jsx";
const TaskEditModal = lazy(()=>import('./TaskWorkspace.jsx').then(module=>({default:module.TaskEditModal})));

const shortDate = value => value ? String(value).slice(5, 10).replace("-", ".") : "미정";
const statusLabels = { NOT_STARTED: "미착수", IN_PROGRESS: "진행 중", DONE: "완료", COMPLETED: "완료", REVIEW: "검토 중", INTERNAL_REVIEW: "검토 중", WAITING_CLIENT: "고객 확인", REVISION: "수정 중", BLOCKED: "차단", ON_HOLD: "보류" };
const doneStatuses = new Set(["DONE", "COMPLETED"]);
const activeStatuses = new Set(["IN_PROGRESS", "REVIEW", "INTERNAL_REVIEW", "WAITING_CLIENT", "REVISION"]);
const splitPoints = value => String(value || "").split(/\r?\n/).map(line => line.trim().replace(/^[•·-]\s*/, "")).filter(Boolean);
function Tag({ code, children }) {
  return <span className={`pb-tag ${["DONE", "COMPLETED"].includes(code) ? "is-done" : ["ON_HOLD", "BLOCKED"].includes(code) ? "is-wait" : ""}`}>{children || statusLabels[code] || code}</span>;
}
function Empty({ children }) { return <p className="pb-empty">{children}</p>; }
function SignalCard({ label, value, unit = "건", detail, tone = "default", progress }) {
  const hasProgress = Number.isFinite(progress);
  return <article className={`pb-signal-card is-${tone}`}>
    <span className="pb-signal-label">{label}</span>
    <div className="pb-signal-value"><strong>{value}</strong><em>{unit}</em></div>
    <small>{detail}</small>
    {hasProgress && <div className="pb-signal-progress" role="progressbar" aria-label={label} aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress}><span style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} /></div>}
  </article>;
}

function MeetingFocus({ latest, state, client, canRead, onRetry, onOpen }) {
  if (state.status === "loading") return <Empty>지난 회의 내용을 불러오는 중입니다.</Empty>;
  if (state.status === "forbidden") return <Empty>회의록 조회 권한이 필요합니다.</Empty>;
  if (state.status === "error") return <div className="pb-empty" role="alert">회의 내용을 불러오지 못했습니다.<button onClick={onRetry}><RefreshCw size={13} />다시 시도</button></div>;
  if (!latest) return <Empty>{client ? "공개된 지난 회의가 없습니다." : "등록된 지난 회의가 없습니다."}</Empty>;
  const decisions = splitPoints(latest.decisions);
  const actions = splitPoints(latest.actionItems);
  return <div className="pb-meeting-focus"><div className="pb-meeting-title"><span>{shortDate(latest.date)} · {latest.visibilityCode === "CLIENT" ? "고객 공개" : latest.visibilityCode === "POCKET_ONLY" ? "포켓 전용" : "프로젝트 팀"}</span><h3>{latest.title}</h3>{latest.attendees && <small>참석 · {latest.attendees}</small>}</div><div className="pb-meeting-points"><section><h4><CheckCircle2 size={14} />결정사항</h4>{decisions.length ? <ul>{decisions.slice(0, 4).map((item, index) => <li key={index}><MeetingText>{item}</MeetingText></li>)}</ul> : <p>기록된 결정사항이 없습니다.</p>}</section><section><h4><CircleDot size={14} />후속업무</h4>{actions.length ? <ul>{actions.slice(0, 4).map((item, index) => <li key={index}><MeetingText>{item}</MeetingText></li>)}</ul> : <p>기록된 후속업무가 없습니다.</p>}</section></div>{latest.discussion && <details className="pb-meeting-discussion"><summary>전체 회의 내용 보기</summary><p><MeetingText>{latest.discussion}</MeetingText></p></details>}{canRead && <button className="pb-meeting-open" type="button" onClick={onOpen}>회의록 전체 보기 <ArrowUpRight size={13} /></button>}</div>;
}
export function ProgressView({ project, role, taskPage, source, actorName, canWrite, onTaskUpdate, onIssueCreate, onIssueUpdate, onIssueArchive, onNavigate, schedule }) {
  const [editingTask,setEditingTask]=useState(null);
  const canEditTask=role!=='client' && canWrite && typeof onTaskUpdate==='function';
  const openEditor=canEditTask?setEditingTask:undefined;
  const [now, setNow] = useState(() => new Date());
  const [meetingState, setMeetingState] = useState({ status: "loading", items: [] });
  const [meetingRetry, setMeetingRetry] = useState(0);
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState("open");
  const [allRequests, setAllRequests] = useState(false);
  const client = role === "client";
  const canReadMeetings = !client || isViewAllowed("daily", project.allowedPages);
  const canWriteIssues = !client && canWrite && taskPage.issueCanWrite === true;
  const { week, progressed, planned } = useMemo(() => progressBriefTasks(taskPage.items || [], now), [taskPage.items, now]);
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!canReadMeetings) { setMeetingState({ status: "forbidden", items: [] }); return; }
    const controller = new AbortController();
    setMeetingState({ status: "loading", items: [] });
    source.dailyMeetings({ projectId: project.id, limit: 100, signal: controller.signal })
      .then(envelope => { if (!controller.signal.aborted) setMeetingState({ status: "ready", items: dailyMeetingsViewModel(envelope).items }); })
      .catch(error => { if (!controller.signal.aborted) setMeetingState({ status: error.code === "forbidden" ? "forbidden" : "error", items: [], error }); });
    return () => controller.abort();
  }, [source, project.id, canReadMeetings, meetingRetry, taskPage.generatedAt]);
  const latest = latestBriefMeeting(meetingState.items, { client, today: week.today });
  const { tasks, completedTasks, activeTasks, upcomingTasks, heldTasks, completionRate } = useMemo(() => {
    const visibleTasks = (taskPage.items || []).filter(task => task.statusCode !== "CANCELLED");
    const completed = progressed.filter(task => doneStatuses.has(task.statusCode));
    const active = progressed.filter(task => activeStatuses.has(task.statusCode));
    const upcoming = planned.filter(task => !doneStatuses.has(task.statusCode) && !activeStatuses.has(task.statusCode) && !["ON_HOLD", "BLOCKED"].includes(task.statusCode));
    const held = visibleTasks.filter(task => ["ON_HOLD", "BLOCKED"].includes(task.statusCode));
    return { tasks: visibleTasks, completedTasks: completed, activeTasks: active, upcomingTasks: upcoming, heldTasks: held, completionRate: visibleTasks.length ? Math.round(completed.length / visibleTasks.length * 100) : 0 };
  }, [taskPage.items, progressed, planned]);
  const issues = taskPage.issues || [];
  const requests = issues.filter(issue => filter === "all" || (filter === "done" ? issue.statusCode === "DONE" : issue.statusCode !== "DONE"));
  const openIssues = issues.filter(issue => issue.statusCode !== "DONE");
  const owners = [...new Set([project.clientName || "고객사", "포켓컴퍼니", "NS"])];
  return <div className="progress-brief">
    <div className="pb-heading"><div><small>프로젝트 / 진행상황</small><h1>{project.name}</h1><p>지난 결정부터 현재 이슈, 다음 업무까지 한 화면에서 판단합니다.</p></div><span><CalendarDays size={14} />{shortDate(week.start)} — {shortDate(week.end)} · 이번 주</span></div>
    <section className="pb-signal-strip" aria-label="프로젝트 핵심 현황"><SignalCard label="전체 진척률" value={completionRate} unit="%" detail={`완료 ${completedTasks.length} / 전체 ${tasks.length}`} tone="progress" progress={completionRate} /><SignalCard label="현재 진행" value={activeTasks.length} detail="검토·수정·고객확인 포함" /><SignalCard label="이번 주 예정" value={upcomingTasks.length} detail="아직 시작하지 않은 업무" /><SignalCard label="확인 필요" value={openIssues.length + heldTasks.length} detail={`이슈 ${openIssues.length} · 보류 ${heldTasks.length}`} tone={openIssues.length || heldTasks.length ? "alert" : "default"} /></section>
    <div className="pb-section-heading"><div><h2>지금 확인할 내용</h2><p>지난 회의의 결정과 아직 닫히지 않은 이슈를 먼저 확인합니다.</p></div></div>
    <div className="pb-priority-grid">
      <section className="pb-panel pb-meeting-panel"><header><div><h2>지난 회의 핵심</h2><small>{latest ? `${shortDate(latest.date)} 기록` : "최근 회의 기준"}</small></div>{canReadMeetings && <button onClick={() => onNavigate("daily")}>회의록 <ArrowUpRight size={13} /></button>}</header><MeetingFocus latest={latest} state={meetingState} client={client} canRead={canReadMeetings} onRetry={() => setMeetingRetry(value => value + 1)} onOpen={() => onNavigate("daily")} /></section>
      <section className="pb-panel pb-attention-panel"><header><div><h2><CircleAlert size={16} />주요 이슈·확인 안건</h2><small>확인 필요 {openIssues.length}건</small></div>{canWriteIssues && <button className={adding ? "is-active" : ""} onClick={() => setAdding(!adding)}>{adding ? <X size={14} /> : <Plus size={14} />}{adding ? "닫기" : "안건 추가"}</button>}</header>
        {heldTasks.length > 0 && <div className="pb-held-tasks"><strong>보류·차단 업무 {heldTasks.length}건</strong>{heldTasks.slice(0, 3).map(task => <button type="button" key={task.id} onClick={() => onNavigate("tasks")}><span>{task.title}</span><Tag code={task.statusCode} /></button>)}</div>}
        <div className="pb-review-toolbar"><span>{canWriteIssues ? "업무의 이슈·추가요청과 같은 기록을 사용합니다." : "공유된 요청을 조회합니다. 등록·답변은 운영 담당자가 처리합니다."}</span><select aria-label="확인 요청 상태" value={filter} onChange={e => { setFilter(e.target.value); setAllRequests(false); }}><option value="open">확인 필요</option><option value="done">확인 완료</option><option value="all">전체</option></select></div>
        {adding && canWriteIssues && <IssueRequestCreateModal projects={[project]} initialProjectId={project.id} owners={owners} actorName={actorName} onCreate={async fields => { await onIssueCreate(fields); setFilter("open"); }} onClose={() => setAdding(false)} />}
        {requests.length ? (allRequests ? requests : requests.slice(0, 3)).map(issue => <IssueRequestCard key={issue.id} issue={issue} canWrite={canWriteIssues} actorName={actorName} onUpdate={onIssueUpdate} onArchive={onIssueArchive} today={week.today} />) : <Empty>해당 상태의 확인 요청이 없습니다.</Empty>}
        {requests.length > 3 && <button className="pb-more" onClick={() => setAllRequests(value => !value)}>{allRequests ? "간단히 보기" : `나머지 ${requests.length - 3}건 더 보기`}</button>}
      </section>
    </div>
    <section className="pb-flow-section"><div className="pb-section-heading"><div><h2>업무 흐름</h2><p>완료된 결과, 현재 실행 중인 일, 다음 순서를 분리해 봅니다.</p></div><button type="button" onClick={() => onNavigate("tasks")}>전체 업무 보기 <ArrowUpRight size={13} /></button></div><div className="pb-work-grid"><TaskColumn title="최근 완료" subtitle="결과와 완료 자료" items={completedTasks} tone="done" client={client} onEdit={openEditor} /><TaskColumn title="현재 진행" subtitle="실행·검토·보류" items={activeTasks} tone="active" client={client} onEdit={openEditor} /><TaskColumn title="이번 주 예정" subtitle={`${shortDate(week.start)}–${shortDate(week.end)}`} items={upcomingTasks} tone="planned" planned client={client} onEdit={openEditor} /></div></section>
    {editingTask && canEditTask && <Suspense fallback={<p role="status">업무 수정 화면을 불러오는 중입니다.</p>}><TaskEditModal key={editingTask.id} task={editingTask} tasks={taskPage.items || []} clientName={project.clientName} onUpdate={onTaskUpdate} onClose={()=>setEditingTask(null)} /></Suspense>}
    {schedule && <section className="pb-schedule" aria-label="프로젝트 전체 간트 일정"><div className="pb-section-heading pb-schedule-heading"><div><h2>전체 일정 흐름</h2><p>업무별 기간과 겹치는 구간을 간트로 확인합니다.</p></div><button type="button" onClick={() => onNavigate("tasks")}>{canWrite ? "업무에서 수정" : "업무 보기"} <ArrowUpRight size={13} /></button></div><DeferredSchedule>{schedule}</DeferredSchedule></section>}
  </div>;
}
