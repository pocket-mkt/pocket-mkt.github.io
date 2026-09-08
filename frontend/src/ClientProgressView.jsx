import { useEffect, useMemo, useState } from "react";
import { CalendarDays, LockKeyhole } from "lucide-react";
import { progressBriefTasks } from "./progressBrief.js";
import { DeferredSchedule, TaskColumn } from "./ProgressFlow.jsx";
import "./progressView.css";

// This component intentionally has no source, meeting, issue or mutation props.
export function ClientProgressView({ project, taskPage, schedule }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(timer); }, []);
  const { week, progressed, planned } = useMemo(() => progressBriefTasks(taskPage.items || [], now), [taskPage.items, now]);
  const completed = progressed.filter(task => ["DONE", "COMPLETED"].includes(task.statusCode));
  const active = progressed.filter(task => !["DONE", "COMPLETED", "CANCELLED"].includes(task.statusCode));
  const activeIds = new Set(active.map(task => task.id));
  const upcoming = planned.filter(task => !["DONE", "COMPLETED", "CANCELLED"].includes(task.statusCode) && !activeIds.has(task.id));
  const shortDate = value => String(value || "").slice(5, 10).replace("-", ".");
  return <div className="progress-brief client-progress-view">
    <div className="pb-heading"><div><small>프로젝트 / 진행상황 - 클라이언트</small><h1>{project.name}</h1><p>공유된 업무의 진행 흐름과 전체 일정을 확인합니다.</p></div><span><LockKeyhole size={14} />고객 공유용 · 읽기 전용</span></div>
    {taskPage.truncated && <p role="status">공개 업무 {taskPage.total}건 중 앞 1,000건을 표시합니다.</p>}
    <section className="pb-flow-section" aria-label="고객 공개 업무 흐름"><div className="pb-section-heading"><div><h2>업무 흐름</h2><p>완료된 결과, 현재 진행 중인 업무, 이번 주 예정 업무를 확인합니다.</p></div><span><CalendarDays size={14} /> {shortDate(week.start)} — {shortDate(week.end)}</span></div><div className="pb-work-grid">
      <TaskColumn title="최근 완료" subtitle="결과와 완료 자료" items={completed} tone="done" client />
      <TaskColumn title="현재 진행" subtitle="실행·검토·보류" items={active} tone="active" client />
      <TaskColumn title="이번 주 예정" subtitle={`${shortDate(week.start)}–${shortDate(week.end)}`} items={upcoming} tone="planned" planned client />
    </div></section>
    <section className="pb-schedule" aria-label="고객 공개 프로젝트 간트"><div className="pb-section-heading pb-schedule-heading"><div><h2>프로젝트 간트</h2><p>업무별 기간과 진행 상태를 확인합니다.</p></div></div><DeferredSchedule>{schedule}</DeferredSchedule></section>
  </div>;
}
