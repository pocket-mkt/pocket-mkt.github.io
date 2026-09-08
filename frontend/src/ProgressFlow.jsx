import { useEffect, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { publicHttpLink } from "./progressBrief.js";
const shortDate = value => value ? String(value).slice(5, 10).replace("-", ".") : "미정";
const statusLabels = { NOT_STARTED: "미착수", IN_PROGRESS: "진행 중", DONE: "완료", COMPLETED: "완료", REVIEW: "검토 중", INTERNAL_REVIEW: "검토 중", WAITING_CLIENT: "고객 확인", REVISION: "수정 중", BLOCKED: "차단", ON_HOLD: "보류" };
function Tag({ code, children }) {
  return <span className={`pb-tag ${["DONE", "COMPLETED"].includes(code) ? "is-done" : ["ON_HOLD", "BLOCKED"].includes(code) ? "is-wait" : ""}`}>{children || statusLabels[code] || code}</span>;
}
function Empty({ children }) { return <p className="pb-empty">{children}</p>; }
function Link({ value, children = "자료 열기" }) {
  const href = publicHttpLink(value);
  return href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}<ArrowUpRight size={13} /></a> : null;
}
export function DeferredSchedule({ children }) {
  const hostRef = useRef(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (ready) return undefined;
    const reveal = () => setReady(true);
    const host = hostRef.current;
    let observer;
    let idleId;
    let fallbackId;
    if (host && "IntersectionObserver" in window) {
      observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) reveal(); }, { rootMargin: "700px 0px" });
      observer.observe(host);
    }
    if ("requestIdleCallback" in window) idleId = window.requestIdleCallback(reveal, { timeout: 1400 });
    else fallbackId = window.setTimeout(reveal, 250);
    return () => {
      observer?.disconnect();
      if (idleId !== undefined) window.cancelIdleCallback?.(idleId);
      if (fallbackId !== undefined) window.clearTimeout(fallbackId);
    };
  }, [ready]);
  return <div ref={hostRef} className="pb-deferred-schedule" aria-busy={!ready}>{ready ? children : <div className="pb-schedule-skeleton"><span /><strong>전체 일정을 준비하고 있습니다.</strong><small>화면의 나머지 내용을 먼저 표시합니다.</small></div>}</div>;
}
export function TaskColumn({ title, subtitle, items, planned, client, tone = "active" }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, 5);
  return <section className={`pb-flow-column is-${tone}`}><header><span className="pb-flow-dot" /><div><h3>{title}</h3><small>{subtitle}</small></div><strong>{items.length}</strong></header>
    {items.length ? <div className="pb-task-list">{visible.map(task => <article key={task.id} className="pb-task">
      {planned ? <span className="pb-date">{shortDate(task.plannedStartDate || task.dueDate)}</span> : <Tag code={task.statusCode} />}
      <div><h3>{task.title}</h3>{task.description && <p>{task.description}</p>}<small>{client ? "포켓컴퍼니" : task.responsibleOrg || task.owner || "담당 미정"} · {planned ? `마감 ${shortDate(task.dueDate)}` : task.updatedAt ? `갱신 ${shortDate(task.updatedAt)}` : "갱신일 미등록"}</small>
      <Link value={task.completionUrl}>완료 자료</Link></div></article>)}</div> : <Empty>{planned ? "이번 주에 일정이 등록된 미완료 업무가 없습니다." : "진행되거나 완료된 업무가 없습니다."}</Empty>}
    {items.length > 5 && <button className="pb-more" onClick={() => setExpanded(value => !value)}>{expanded ? "간단히 보기" : `전체 ${items.length}건 펼치기`}</button>}
  </section>;
}
