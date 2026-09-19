const USER_FACING_TASK_FIELDS = new Set([
  "task_group_name",
  "title",
  "status_code",
  "description",
  "planned_start_date",
  "due_date",
  "schedule_dates_json",
  "progress_percent",
  "completion_url",
  "remarks",
  "priority_code",
  "responsible_org_code",
  "workstream_code",
  "phase_code",
  "visibility_code",
]);

const MEANINGFUL_ACTIONS_WITHOUT_CHANGES = new Set(["CREATED", "ARCHIVED", "RESTORED", "APPROVED", "REJECTED"]);
const USER_TASK_ACTIONS = new Set(["CREATED", "UPDATED", "ARCHIVED", "RESTORED"]);

function readableActor(value) {
  const actor = String(value || "").trim();
  if (!actor || actor === "확인되지 않은 사용자") return false;
  if (/^(system|시스템|migration|마이그레이션)$/i.test(actor)) return false;
  if (/^(usr|user|actor)-[a-z0-9_-]+$/i.test(actor)) return false;
  return true;
}

export function readableTaskActivities(items = [], tasks = []) {
  const taskRecords = new Map(tasks.map((task) => [String(task.id || ""), task]));
  return items.map((item) => {
    if (item?.type !== "task") return null;
    const task = taskRecords.get(String(item.entityId || ""));
    const taskTitle = String(item.taskTitle || task?.title || "").trim();
    const changes = (item.changes || []).filter((change) => USER_FACING_TASK_FIELDS.has(String(change?.field || "")));
    const actionCode = String(item.actionCode || "").toUpperCase();
    if (!item.userInitiated || !USER_TASK_ACTIONS.has(actionCode)) return null;
    if (!taskTitle || !readableActor(item.actor)) return null;
    if (!changes.length && !MEANINGFUL_ACTIONS_WITHOUT_CHANGES.has(actionCode)) return null;
    const ownerChange = [...changes].reverse().find((change) => change.field === "responsible_org_code");
    const responsibleOrgCode = String(task?.responsibleOrgCode || task?.responsible_org_code || ownerChange?.after || "").toUpperCase();
    return { ...item, taskTitle, changes, responsibleOrgCode };
  }).filter(Boolean);
}

export function taskActivityDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addIsoDays(value, offset) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function filterTaskActivities(items = [], filters = {}) {
  const dateFilter = String(filters.dateFilter || "ALL").toUpperCase();
  const ownerFilter = String(filters.ownerFilter || "ALL").toUpperCase();
  const today = typeof filters.today === "string" ? filters.today.slice(0, 10) : taskActivityDateKey(filters.today || new Date());
  const yesterday = addIsoDays(today, -1);
  const sevenDayStart = addIsoDays(today, -6);
  return items.filter((item) => {
    const date = taskActivityDateKey(item.createdAt);
    const dateMatches = dateFilter === "ALL"
      || (dateFilter === "TODAY" && date === today)
      || (dateFilter === "YESTERDAY" && date === yesterday)
      || (dateFilter === "LAST_7_DAYS" && date >= sevenDayStart && date <= today);
    const ownerMatches = ownerFilter === "ALL" || item.responsibleOrgCode === ownerFilter;
    return dateMatches && ownerMatches;
  });
}

export function groupTaskActivitiesByDate(items = []) {
  const groups = new Map();
  items.forEach((item) => {
    const date = taskActivityDateKey(item.createdAt) || "날짜 미상";
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(item);
  });
  return [...groups.entries()].map(([date, groupItems]) => ({ date, items: groupItems }));
}

export function taskActivitySentence(item = {}) {
  const action = String(item.actionCode || "").toUpperCase();
  if (action === "CREATED") return "업무가 추가되었습니다.";
  if (action === "ARCHIVED") return "업무가 보관되었습니다.";
  if (action === "RESTORED") return "삭제한 업무를 되돌렸습니다.";
  if (action === "APPROVED") return "업무가 승인되었습니다.";
  if (action === "REJECTED") return "업무가 반려되었습니다.";
  return "업무 정보가 변경되었습니다.";
}
