import { scheduleDateBounds, taskScheduleDates } from "./taskGantt.js";
import { taskWorkstreamLabel } from "./taskWorkstreams.js";
import { TASK_CHANNEL_LABELS } from "./taskChannels.js";

const DAY_MS = 86_400_000;

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12, 0, 0, 0);
  }
  const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isoDate(value) {
  if (!value) return null;
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function dayDiff(left, right) {
  return Math.round((right.getTime() - left.getTime()) / DAY_MS);
}

export function taskScheduleCategory(task = {}) {
  return taskWorkstreamLabel(task);
}

const TASK_MEDIA_LABELS = {
  ...TASK_CHANNEL_LABELS,
  YOUTUBE: "YouTube",
  INSTAGRAM: "Instagram",
  NAVER_BLOG: "네이버블로그",
  TIKTOK: "TikTok",
  ADS: "Ads",
};

const TASK_MEDIA_CODES = Object.fromEntries(
  Object.entries(TASK_MEDIA_LABELS).map(([code, label]) => [label.toLocaleUpperCase("ko"), code]),
);

export function taskScheduleMediaCode(task = {}) {
  const explicit = String(task.categoryCode || task.category_code || "").trim().toUpperCase();
  if (explicit) return explicit;
  const label = taskScheduleMedia(task).replace(/\s+/g, " ").trim().toLocaleUpperCase("ko");
  return TASK_MEDIA_CODES[label] || "";
}

export function taskScheduleMedia(task = {}) {
  const code = String(task.categoryCode || "").trim().toUpperCase();
  return TASK_MEDIA_LABELS[code] || String(task.category || task.parent || "미지정").trim() || "미지정";
}

function taskScheduleMediaKey(task = {}) {
  return taskScheduleMedia(task).replace(/\s+/g, " ").trim().toLocaleUpperCase("ko");
}

// sort_order is the authored row order. Preserve it inside each media and
// only gather identical media so the table and Gantt share one row sequence.
export function groupTaskScheduleByMedia(tasks = []) {
  const groups = [];
  const byMedia = new Map();
  tasks.forEach((task) => {
    const key = taskScheduleMediaKey(task);
    let group = byMedia.get(key);
    if (!group) {
      group = [];
      byMedia.set(key, group);
      groups.push(group);
    }
    group.push(task);
  });
  return groups.flatMap((group) => {
    const authored = group.map((task, index) => ({ task, index })).sort((left, right) => {
      const leftOrder = Number(left.task.sortOrder);
      const rightOrder = Number(right.task.sortOrder);
      const leftValue = Number.isFinite(leftOrder) ? leftOrder : Number.MAX_SAFE_INTEGER;
      const rightValue = Number.isFinite(rightOrder) ? rightOrder : Number.MAX_SAFE_INTEGER;
      return leftValue - rightValue || left.index - right.index;
    });
    return authored.map(({ task }) => task);
  });
}

function normalizedSeriesText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLocaleUpperCase("ko");
}

export function taskScheduleSeries(task = {}) {
  const title = String(task.title || "").trim();
  const match = /^(.*?\S)\s+(\d+)\s*\/\s*(\d+)\s*$/.exec(title);
  if (!match) return null;
  const item = Number(match[2]);
  const total = Number(match[3]);
  if (!Number.isInteger(item) || !Number.isInteger(total) || total < 2 || item < 1 || item > total) return null;
  const baseTitle = match[1].trim();
  const key = [
    taskScheduleMediaKey(task),
    normalizedSeriesText(taskScheduleCategory(task)),
    normalizedSeriesText(baseTitle),
    total,
  ].join("::");
  return { key, baseTitle, item, total };
}

// Numbered repetitions stay as individual records in the database, but the
// schedule UI can present them as one expandable row. A group only exists when
// at least two matching repetitions are currently visible.
export function groupTaskScheduleSeries(tasks = []) {
  const buckets = new Map();
  tasks.forEach((task) => {
    const series = taskScheduleSeries(task);
    if (!series) return;
    const bucket = buckets.get(series.key) || [];
    bucket.push({ task });
    buckets.set(series.key, bucket);
  });

  const emitted = new Set();
  const rows = [];
  tasks.forEach((task, sourceIndex) => {
    const series = taskScheduleSeries(task);
    const bucket = series ? buckets.get(series.key) : null;
    if (!series || !bucket || bucket.length < 2) {
      rows.push({ key: `task:${task.id || sourceIndex}`, type: "task", task, tasks: [task] });
      return;
    }
    if (emitted.has(series.key)) return;
    emitted.add(series.key);
    rows.push({
      key: `series:${series.key}`,
      type: "series",
      baseTitle: series.baseTitle,
      expectedTotal: series.total,
      tasks: bucket.map((entry) => entry.task),
    });
  });
  return rows;
}

export function reorderTaskSchedule(tasks = [], sourceKey, targetTaskId, position = "before") {
  const requestedIds = Array.isArray(sourceKey) ? sourceKey.map(String) : [];
  const source = Array.isArray(sourceKey) ? "" : String(sourceKey || "");
  const target = String(targetTaskId || "");
  if ((!source && !requestedIds.length) || !target) return tasks.slice();
  const seriesEntry = source.startsWith("series:")
    ? groupTaskScheduleSeries(tasks).find((entry) => entry.key === source)
    : null;
  const requestedSet = new Set(requestedIds);
  const sourceTasks = seriesEntry?.tasks || tasks.filter((task) => requestedSet.size
    ? requestedSet.has(String(task.id))
    : String(task.id) === source);
  const sourceIds = new Set(sourceTasks.map((task) => String(task.id)));
  if (!sourceTasks.length || sourceIds.has(target)) return tasks.slice();
  const ordered = tasks.filter((task) => !sourceIds.has(String(task.id)));
  const targetIndex = ordered.findIndex((task) => String(task.id) === target);
  if (targetIndex < 0) return tasks.slice();
  const insertAt = targetIndex + (String(position).toLowerCase() === "after" ? 1 : 0);
  ordered.splice(insertAt, 0, ...sourceTasks);
  return ordered;
}

// Shift selection always follows the rows currently visible to the user.
// This mirrors native file-list behaviour while keeping selections outside the
// current filter untouched.
export function selectTaskRange(tasks = [], selectedIds = new Set(), anchorTaskId, targetTaskId, checked = true) {
  const next = new Set(selectedIds);
  const visibleIds = tasks.map((task) => String(task.id));
  const anchorIndex = visibleIds.indexOf(String(anchorTaskId || ""));
  const targetIndex = visibleIds.indexOf(String(targetTaskId || ""));
  if (anchorIndex < 0 || targetIndex < 0) {
    if (checked) next.add(targetTaskId); else next.delete(targetTaskId);
    return next;
  }
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  tasks.slice(start, end + 1).forEach(({ id }) => {
    if (checked) next.add(id); else next.delete(id);
  });
  return next;
}

export function taskScheduleStatusGroup(task = {}) {
  const status = String(task.statusCode || "").toUpperCase();
  if (["DONE", "COMPLETED"].includes(status)) return "DONE";
  if (["ON_HOLD", "BLOCKED"].includes(status)) return "HOLD";
  if (["IN_PROGRESS", "INTERNAL_REVIEW", "WAITING_CLIENT", "REVISION"].includes(status)) return "ACTIVE";
  if (["NOT_STARTED", "TODO", "PLANNED"].includes(status)) return "TODO";
  return "OTHER";
}

export function taskHiddenFromClient(task = {}) {
  return String(task.visibilityCode || task.visibility_code || "").trim().toUpperCase() !== "CLIENT";
}

function taskWeekRange(today, weekOffset) {
  const start = new Date(today);
  const day = start.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + mondayOffset + weekOffset * 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return { start, end };
}

export function filterTaskSchedule(tasks = [], filters = {}, todayValue = new Date()) {
  const status = String(filters.status || "ALL");
  const category = String(filters.category || "ALL");
  const schedule = String(filters.schedule || "ALL").toUpperCase();
  const media = String(filters.media || "ALL").replace(/\s+/g, " ").trim().toLocaleUpperCase("ko");
  const owner = String(filters.owner || "ALL").toUpperCase();
  const today = dateOnly(todayValue);

  return tasks.filter((task) => {
    if (status !== "ALL" && taskScheduleStatusGroup(task) !== status) return false;
    if (category !== "ALL" && taskScheduleCategory(task) !== category) return false;
    if (media !== "ALL" && taskScheduleMediaKey(task) !== media) return false;
    if (owner !== "ALL" && String(task.responsibleOrgCode || task.responsible_org_code || "").toUpperCase() !== owner) return false;
    if (schedule === "ALL") return true;

    const selectedDates = taskScheduleDates(task);
    if (!today || !selectedDates.length) return false;
    if (schedule === "TODAY") return selectedDates.includes(isoDate(today));
    if (schedule === "THIS_MONTH") return selectedDates.some(date => date.slice(0, 7) === isoDate(today).slice(0, 7));
    const offset = schedule === "LAST_WEEK" ? -1 : schedule === "THIS_WEEK" ? 0 : schedule === "NEXT_WEEK" ? 1 : null;
    if (offset !== null) {
      const week = taskWeekRange(today, offset);
      return selectedDates.some((date) => {
        const selected = dateOnly(date);
        return selected && selected >= week.start && selected <= week.end;
      });
    }
    return true;
  });
}

export function sortTaskSchedule(tasks = []) {
  const dateValue = (value) => dateOnly(value)?.getTime() ?? Number.POSITIVE_INFINITY;
  return tasks.slice().sort((left, right) => {
    const startDifference = dateValue(left.plannedStartDate) - dateValue(right.plannedStartDate);
    if (startDifference) return startDifference;
    const endDifference = dateValue(left.dueDate) - dateValue(right.dueDate);
    if (endDifference) return endDifference;
    const orderDifference = Number(left.sortOrder ?? Number.MAX_SAFE_INTEGER) - Number(right.sortOrder ?? Number.MAX_SAFE_INTEGER);
    if (orderDifference) return orderDifference;
    return String(left.title || left.id || "").localeCompare(String(right.title || right.id || ""), "ko");
  });
}

export function toggleScheduleStatusFilter(currentStatus, selectedStatus) {
  const current = String(currentStatus || "ALL").toUpperCase();
  const selected = String(selectedStatus || "ALL").toUpperCase();
  return current === selected ? "ALL" : selected;
}

export function buildTaskTimeline(tasks = [], project = {}, todayValue = new Date()) {
  const candidates = tasks.map((task) => {
    const bounds = scheduleDateBounds(taskScheduleDates(task));
    const start = dateOnly(bounds.start || task.plannedStartDate || task.dueDate);
    const end = dateOnly(bounds.end || task.dueDate || task.plannedStartDate);
    return start && end ? { task, start, end: end < start ? start : end } : null;
  }).filter(Boolean);
  const projectStart = dateOnly(project.startDate);
  const projectEnd = dateOnly(project.endDate);
  // 실제 업무가 있으면 원본 캠페인 간트처럼 업무의 첫 날짜와 마지막
  // 날짜만 축으로 사용한다. 프로젝트 기간은 빈 일정의 예비 범위다.
  const starts = candidates.length
    ? candidates.map((item) => item.start)
    : projectStart ? [projectStart] : [];
  const ends = candidates.length
    ? candidates.map((item) => item.end)
    : projectEnd ? [projectEnd] : [];
  if (!starts.length || !ends.length) return { start: null, end: null, dayCount: 0, rows: [], ticks: [], todayLeft: null };

  const start = new Date(Math.min(...starts.map((item) => item.getTime())));
  const end = new Date(Math.max(...ends.map((item) => item.getTime())));
  const dayCount = Math.max(1, dayDiff(start, end) + 1);
  const denominator = Math.max(1, dayCount - 1);
  const tickStep = Math.max(1, Math.ceil(dayCount / 8));
  const ticks = [];
  for (let offset = 0; offset < dayCount; offset += tickStep) {
    const date = new Date(start);
    date.setDate(date.getDate() + offset);
    ticks.push({ date: isoDate(date), label: `${date.getMonth() + 1}.${date.getDate()}`, left: offset / denominator * 100 });
  }
  if (ticks[ticks.length - 1]?.date !== isoDate(end)) ticks.push({ date: isoDate(end), label: `${end.getMonth() + 1}.${end.getDate()}`, left: 100 });

  const today = dateOnly(todayValue);
  const todayOffset = today ? dayDiff(start, today) : -1;
  const todayLeft = todayOffset >= 0 && todayOffset < dayCount ? todayOffset / denominator * 100 : null;
  const rows = candidates.map(({ task, start: rowStart, end: rowEnd }) => {
    const startOffset = Math.max(0, dayDiff(start, rowStart));
    const duration = Math.max(1, dayDiff(rowStart, rowEnd) + 1);
    return {
      task,
      startDate: isoDate(rowStart),
      endDate: isoDate(rowEnd),
      left: startOffset / denominator * 100,
      width: Math.max(1.2, Math.min(100 - startOffset / denominator * 100, duration / dayCount * 100)),
    };
  });
  return { start: isoDate(start), end: isoDate(end), dayCount, rows, ticks, todayLeft };
}

export function withDisplayDeadline(task, displayDeadline) {
  return displayDeadline ? { ...task, due: displayDeadline } : task;
}
