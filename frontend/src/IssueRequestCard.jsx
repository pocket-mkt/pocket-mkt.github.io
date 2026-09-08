import { useEffect, useState } from "react";
import { ArrowUpRight, Check, MessageSquare } from "lucide-react";
import { appendBriefReply, publicHttpLink, requestDeadlineFields, requestDeadlineLabel, seoulDate } from "./progressBrief.js";
import "./issueRequestCard.css";

const shortDate = (value) => value ? String(value).slice(5, 10).replace("-", ".") : "미정";

export default function IssueRequestCard({ issue, canWrite = false, actorName, onUpdate, onUpdated, today = seoulDate(), showProject = false }) {
  const [current, setCurrent] = useState(issue);
  const [replyOpen, setReplyOpen] = useState(false);
  const [reply, setReply] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editingDeadline, setEditingDeadline] = useState(false);
  const [deadline, setDeadline] = useState(issue.dueDate || "");

  useEffect(() => {
    setCurrent(issue);
    setDeadline(issue.dueDate || "");
  }, [issue]);

  const done = ["DONE", "CLOSED", "COMPLETED"].includes(current.statusCode);
  const href = publicHttpLink(current.completionUrl);
  const save = async (fields) => {
    if (!canWrite || !onUpdate || saving) return false;
    setSaving(true);
    setError("");
    try {
      const saved = await onUpdate(current, fields);
      const next = { ...current, ...(saved || {}), projectId: current.projectId, clientName: current.clientName, projectName: current.projectName };
      setCurrent(next);
      onUpdated?.(next);
      return true;
    } catch (saveError) {
      setError(saveError?.code === "conflict"
        ? "다른 사용자가 먼저 변경했습니다. 화면을 새로고침한 뒤 다시 저장해 주세요."
        : saveError?.message || "저장하지 못했습니다.");
      return false;
    } finally {
      setSaving(false);
    }
  };
  const submitReply = async (event) => {
    event.preventDefault();
    try {
      if (await save(appendBriefReply(current, reply, actorName))) {
        setReply("");
        setReplyOpen(false);
      }
    } catch (replyError) {
      setError(replyError?.message || "답변을 확인해 주세요.");
    }
  };

  return <article className="issue-request-card">
    <div className="issue-request-meta">
      <span>{showProject && current.clientName ? `${current.clientName} · ` : ""}{current.kind || "확인 요청"} · 확인 담당 {current.owner || "미지정"} · {shortDate(current.date)}</span>
      <strong className={done ? "is-done" : "is-open"}>{done ? "확인 완료" : "확인 필요"}</strong>
    </div>
    <h3>{current.relatedTask || current.projectName || "확인 요청"}</h3>
    <p>{current.body || "등록된 내용이 없습니다."}</p>
    {href && <a className="issue-request-link" href={href} target="_blank" rel="noopener noreferrer">관련 자료 열기 <ArrowUpRight size={13} /></a>}
    <div className={`issue-request-deadline${!done && current.dueDate && current.dueDate < today ? " is-overdue" : ""}`}>
      <span>{requestDeadlineLabel(current, today)}</span>
      {canWrite && !editingDeadline && <button type="button" disabled={saving} onClick={() => { setDeadline(current.dueDate || ""); setEditingDeadline(true); }}>{current.dueDate ? "마감일 변경" : "마감일 설정"}</button>}
    </div>
    {editingDeadline && canWrite && <form className="issue-request-deadline-form" onSubmit={async (event) => { event.preventDefault(); if (await save(requestDeadlineFields(deadline))) setEditingDeadline(false); }}>
      <label><span>컨펌 마감일</span><input type="date" value={deadline} disabled={saving} onChange={(event) => setDeadline(event.target.value)} /></label>
      <button type="button" disabled={saving} onClick={() => setDeadline("")}>기한 해제</button>
      <button type="submit" disabled={saving}>{saving ? "저장 중…" : "마감일 저장"}</button>
      <button type="button" disabled={saving} onClick={() => setEditingDeadline(false)}>취소</button>
    </form>}
    {current.remarks && <details className="issue-request-replies"><summary>답변·추가 메모 보기</summary><p>{current.remarks}</p></details>}
    {canWrite && <div className="issue-request-actions">
      <button type="button" disabled={saving} aria-expanded={replyOpen} onClick={() => setReplyOpen((value) => !value)}><MessageSquare size={14} />답변 작성</button>
      <button type="button" disabled={saving} onClick={() => void save({ status_code: done ? "IN_PROGRESS" : "DONE" })}><Check size={14} />{done ? "다시 확인 요청" : "확인 완료"}</button>
    </div>}
    {replyOpen && canWrite && <form className="issue-request-reply-form" onSubmit={submitReply}><label><span>답변</span><textarea required autoFocus maxLength={4000} rows={3} value={reply} onChange={(event) => setReply(event.target.value)} placeholder="확인 결과나 요청에 대한 답변을 입력하세요" /></label><button type="submit" disabled={saving}>{saving ? "저장 중…" : "답변 저장"}</button></form>}
    {error && <p className="issue-request-error" role="alert">{error}</p>}
  </article>;
}
