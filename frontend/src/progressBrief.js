import { normalizeScheduleDates } from "./taskGantt.js";

export function seoulDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function requestCreatedLabel(createdAt, fallbackDate = null) {
  const instant = createdAt ? new Date(createdAt) : null;
  if (instant && Number.isFinite(instant.getTime())) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(instant).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    return `${Number(parts.month)}.${Number(parts.day)} ${parts.hour.padStart(2, "0")}:${parts.minute.padStart(2, "0")}`;
  }
  return fallbackDate ? String(fallbackDate).slice(5, 10).replace("-", ".") : "미정";
}

export function briefWeek(now = new Date()) {
  const today = seoulDate(now);
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { today, start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function progressBriefTasks(tasks = [], now = new Date()) {
  const week = briefWeek(now);
  const progressed = tasks.filter(task => ["DONE", "COMPLETED", "IN_PROGRESS", "REVIEW", "INTERNAL_REVIEW", "WAITING_CLIENT", "REVISION", "BLOCKED", "ON_HOLD"].includes(task.statusCode))
    .slice().sort((a, b) => String(b.updatedAt || b.completedAt || "").localeCompare(String(a.updatedAt || a.completedAt || "")));
  const planned = tasks.filter(task => {
    if (["DONE", "COMPLETED", "CANCELLED"].includes(task.statusCode)) return false;
    const explicit = normalizeScheduleDates(task.scheduleDates);
    if (explicit !== null) return explicit.some(day => day >= week.start && day <= week.end);
    const start = task.plannedStartDate || task.dueDate;
    const end = task.dueDate || task.plannedStartDate;
    return Boolean(start && end && start <= end && start <= week.end && end >= week.start);
  }).sort((a, b) => String(a.plannedStartDate || a.dueDate || "").localeCompare(String(b.plannedStartDate || b.dueDate || "")));
  return { week, progressed, planned };
}

export function publicHttpLink(value) {
  try {
    const url = new URL(String(value || "").trim());
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

export function latestBriefMeeting(items = [], { client = false, today = seoulDate() } = {}) {
  return items.filter(item => item.date && item.date <= today && (!client || item.visibilityCode === "CLIENT"))
    .slice().sort((a, b) => b.date.localeCompare(a.date) || String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0] || null;
}

export function briefRequestFields(fields) {
  const link = String(fields.link || "").trim();
  if (link && !publicHttpLink(link)) throw new Error("http 또는 https 자료 링크를 입력해 주세요.");
  if (!fields.title?.trim() || !fields.body?.trim() || !fields.owner?.trim() || !fields.kind?.trim() || !fields.requester?.trim()) throw new Error("필수 항목을 모두 입력해 주세요.");
  return {
    kind_text: fields.kind, related_task_text: fields.title.trim(), body_text: fields.body.trim(),
    owner_text: fields.owner, requester_text: fields.requester.trim(), completion_url: link ? publicHttpLink(link) : "", status_code: "IN_PROGRESS",
    due_date: requestDeadlineFields(fields.deadline).due_date,
  };
}

export function requestDeadlineFields(value) {
  const day = String(value || "").trim();
  if (day && (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(`${day}T00:00:00Z`)) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day)) {
    throw new Error("올바른 마감일을 입력해 주세요.");
  }
  return { due_date: day || null };
}

export function requestDeadlineLabel(issue, today = seoulDate()) {
  if (!issue.dueDate) return "마감일 미정";
  if (issue.statusCode === "DONE") return `마감 ${issue.dueDate}`;
  return `${issue.dueDate < today ? "기한 초과" : issue.dueDate === today ? "오늘 마감" : "마감"} · ${issue.dueDate}`;
}

export function appendBriefReply(issue, text, actorName, now = new Date()) {
  if (!text?.trim()) throw new Error("답변 내용을 입력해 주세요.");
  const stamp = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" }).format(now);
  const remarks = [issue.remarks, `[${stamp} · ${actorName || "운영 담당자"}]\n${text.trim()}`].filter(Boolean).join("\n\n");
  if (remarks.length > 10000) throw new Error("답변 기록이 길어졌습니다. 새 확인 요청으로 이어서 작성해 주세요.");
  return { remarks };
}
