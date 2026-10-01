const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

export function taskMonthKey(value, fallback = "") {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).formatToParts(value);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${map.year}-${map.month}`;
  }
  const key = String(value || "").slice(0, 7);
  return MONTH_KEY.test(key) ? key : fallback;
}

export function shiftTaskMonth(month, offset) {
  const key = taskMonthKey(month);
  if (!key) return "";
  const [year, monthNumber] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + Number(offset || 0), 1, 12));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function taskMonthLabel(month, compact = false) {
  const key = taskMonthKey(month);
  if (!key) return "월 미지정";
  const [year, monthNumber] = key.split("-").map(Number);
  return compact ? `${monthNumber}월` : `${year}년 ${monthNumber}월`;
}

export function normalizeTaskExecutionMonth(value, fallback = "") {
  const key = taskMonthKey(value, taskMonthKey(fallback));
  return key ? `${key}-01` : "";
}

export function inferredTaskExecutionMonth(task = {}, fallbackMonth = "") {
  return taskMonthKey(
    task.executionMonth || task.execution_month || task.plannedStartDate || task.planned_start_date || task.dueDate || task.due_date || task.createdAt || task.created_at,
    taskMonthKey(fallbackMonth),
  );
}

function taskDone(task = {}) {
  return ["DONE", "COMPLETED"].includes(String(task.statusCode || task.status_code || "").toUpperCase());
}

function taskMonthBounds(month) {
  const key = taskMonthKey(month);
  if (!key) return null;
  return { start: `${key}-01`, end: `${shiftTaskMonth(key, 1)}-01` };
}

export function taskMonthRelation(task = {}, selectedMonth, fallbackMonth = selectedMonth) {
  const selected = taskMonthKey(selectedMonth);
  const execution = inferredTaskExecutionMonth(task, fallbackMonth);
  if (!selected || !execution || execution > selected) return null;
  if (execution === selected) return "CURRENT";

  const bounds = taskMonthBounds(selected);
  const completed = String(task.completedDate || task.completed_at || task.completedAt || "").slice(0, 10);
  if (completed && completed >= bounds.start && completed < bounds.end) return "CARRYOVER";
  if (!taskDone(task)) return "CARRYOVER";

  const start = String(task.plannedStartDate || task.planned_start_date || "").slice(0, 10);
  const due = String(task.dueDate || task.due_date || "").slice(0, 10);
  return start && due && start < bounds.end && due >= bounds.start ? "CARRYOVER" : null;
}

export function tasksForExecutionMonth(tasks = [], selectedMonth, fallbackMonth = selectedMonth) {
  return tasks.filter((task) => taskMonthRelation(task, selectedMonth, fallbackMonth));
}

export function taskMonthOptions(tasks = [], currentValue = new Date()) {
  const current = taskMonthKey(currentValue);
  const keys = new Set([shiftTaskMonth(current, -1), current]);
  tasks.forEach((task) => {
    const month = inferredTaskExecutionMonth(task, current);
    if (month) keys.add(month);
  });
  return [...keys].filter(Boolean).sort();
}
