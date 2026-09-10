const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dateAtNoon(value) {
  if (!value || !ISO_DATE.test(String(value).slice(0, 10))) return null;
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function ganttAxisDay(cursor, monthStart = cursor.getDate() === 1) {
  const iso = isoDate(cursor);
  const monthIndex = cursor.getFullYear() * 12 + cursor.getMonth();
  return { iso, day: cursor.getDate(), weekday: ["일", "월", "화", "수", "목", "금", "토"][cursor.getDay()],
    monthKey: iso.slice(0, 7), monthTone: monthIndex % 2,
    monthStart, weekend: [0, 6].includes(cursor.getDay()) };
}

// Extend the display axis only; never change any task's saved schedule.
export function buildGanttAxis(startValue, endValue, minimumDays = 0) {
  const start = dateAtNoon(startValue);
  const end = dateAtNoon(endValue);
  if (!start || !end || start > end) return [];
  const fillEnd = new Date(start);
  fillEnd.setDate(fillEnd.getDate() + Math.max(0, Math.ceil(minimumDays) - 1));
  const last = end > fillEnd ? end : fillEnd;
  const days = [];
  for (const cursor = new Date(start); cursor <= last; cursor.setDate(cursor.getDate() + 1)) {
    days.push(ganttAxisDay(cursor));
  }
  return days;
}

function estimatedTextWidth(value) {
  return Array.from(String(value || "")).reduce((width, character) => (
    width + (/[^\u0000-\u00ff]/.test(character) ? 12.5 : 7.2)
  ), 0);
}

export function ganttTaskLabelWidth(tasks = [], { canWrite = true, showOwners = true } = {}) {
  const longestTitleWidth = tasks.reduce((maximum, task) => (
    Math.max(maximum, estimatedTextWidth(task?.title || "제목 없는 업무"))
  ), 0);
  const controlsWidth = canWrite ? (showOwners ? 280 : 218) : (showOwners ? 120 : 76);
  const minimumWidth = canWrite ? 360 : 280;
  return Math.min(620, Math.max(minimumWidth, Math.ceil((longestTitleWidth + controlsWidth) / 8) * 8));
}

export function ganttMonthClass(day) {
  return ` month-tone-${day.monthTone}${day.monthStart ? " month-start" : ""}`;
}

export function normalizeScheduleDates(value) {
  let dates = value;
  if (typeof dates === "string") {
    const text = dates.trim();
    if (!text) return null;
    try {
      dates = JSON.parse(text);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(dates)) return null;
  return [...new Set(dates
    .map((date) => String(date || "").slice(0, 10))
    .filter((date) => {
      const parsed = ISO_DATE.test(date) ? dateAtNoon(date) : null;
      return parsed && isoDate(parsed) === date;
    }))]
    .sort();
}

export function scheduleDateRange(startValue, endValue) {
  const start = dateAtNoon(startValue);
  const end = dateAtNoon(endValue);
  if (!start || !end) return [];
  const first = start <= end ? new Date(start) : new Date(end);
  const last = end >= start ? new Date(end) : new Date(start);
  const dates = [];
  for (const cursor = new Date(first); cursor <= last; cursor.setDate(cursor.getDate() + 1)) {
    dates.push(isoDate(cursor));
  }
  return dates;
}

// Explicit [] means the user erased the entire Gantt schedule. A missing
// schedule_dates_json keeps backward compatibility with start/end-only rows.
export function taskScheduleDates(task = {}) {
  const explicit = normalizeScheduleDates(task.scheduleDates);
  return explicit === null
    ? scheduleDateRange(task.plannedStartDate, task.dueDate)
    : explicit;
}

export function scheduleDateBounds(dates = []) {
  const normalized = normalizeScheduleDates(dates) || [];
  return normalized.length
    ? { start: normalized[0], end: normalized[normalized.length - 1] }
    : { start: "", end: "" };
}

export function serializeScheduleDates(dates = []) {
  return JSON.stringify(normalizeScheduleDates(dates) || []);
}

export function scheduleDatesEqual(left = [], right = []) {
  const a = normalizeScheduleDates(left) || [];
  const b = normalizeScheduleDates(right) || [];
  return a.length === b.length && a.every((date, index) => date === b[index]);
}

export function groupGanttTasks(tasks = [], categoryOf = (task) => task.category || "미분류") {
  const groups = [];
  const byCategory = new Map();
  tasks.forEach((task) => {
    const label = categoryOf(task);
    let group = byCategory.get(label);
    if (!group) {
      group = { label, tasks: [] };
      byCategory.set(label, group);
      groups.push(group);
    }
    group.tasks.push(task);
  });
  return groups;
}

export function paintGanttRectangle(rows = [], anchor = {}, target = {}, mode = "paint") {
  const rowStart = Math.min(Number(anchor.rowIndex), Number(target.rowIndex));
  const rowEnd = Math.max(Number(anchor.rowIndex), Number(target.rowIndex));
  const dayStart = Math.min(Number(anchor.dayIndex), Number(target.dayIndex));
  const dayEnd = Math.max(Number(anchor.dayIndex), Number(target.dayIndex));
  const axisDays = Array.isArray(anchor.axisDays) ? anchor.axisDays : [];
  const selectedDates = axisDays.slice(dayStart, dayEnd + 1);
  const erase = mode === "erase";

  return new Map(rows.map((row, rowIndex) => {
    const original = normalizeScheduleDates(row.scheduleDates) || [];
    if (rowIndex < rowStart || rowIndex > rowEnd) return [row.id, original];
    const next = new Set(original);
    selectedDates.forEach((date) => erase ? next.delete(date) : next.add(date));
    return [row.id, [...next].sort()];
  }));
}
