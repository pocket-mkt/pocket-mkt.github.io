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

export function tasksForExecutionMonths(tasks = [], selectedMonths = [], fallbackMonth = "") {
  const months = new Set([...selectedMonths].map((month) => taskMonthKey(month)).filter(Boolean));
  return tasks.filter((task) => months.has(inferredTaskExecutionMonth(task, fallbackMonth)));
}

export function toggleTaskMonth(selectedMonths, month) {
  const next = new Set(selectedMonths);
  const key = taskMonthKey(month);
  if (!key) return next;
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
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
