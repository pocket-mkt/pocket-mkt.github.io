import { scheduleDateRange, serializeScheduleDates, taskScheduleDates } from "./taskGantt.js";

export function taskResponsibleOrgOptions(clientName = "고객사") {
  return [
    ["POCKET", "포켓"],
    ["NS", "NS"],
    ["CLIENT", String(clientName || "고객사").trim() || "고객사"],
  ];
}

export function taskResponsibleOrgLabel(code, clientName = "고객사") {
  return Object.fromEntries(taskResponsibleOrgOptions(clientName))[String(code || "").toUpperCase()] || "포켓";
}

const TASK_STATUS_CYCLE = ["NOT_STARTED", "IN_PROGRESS", "DELAYED", "DONE", "ON_HOLD"];
const TASK_OWNER_CYCLE = ["POCKET", "NS", "CLIENT"];
const TASK_WORKSTREAM_CODES = new Set(["MARKETING", "DESIGN", "VIDEO"]);
const TASK_WORKSTREAM_ALIASES = Object.freeze({ MKT: "MARKETING", DSN: "DESIGN", VID: "VIDEO" });

export function normalizeTaskWorkstreamCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return TASK_WORKSTREAM_ALIASES[code] || code;
}

export function nextTaskStatusCode(value) {
  const status = String(value || "").toUpperCase();
  const normalized = status === "TODO"
    ? "NOT_STARTED"
    : ["INTERNAL_REVIEW", "WAITING_CLIENT", "REVISION"].includes(status)
      ? "IN_PROGRESS"
      : status === "COMPLETED"
        ? "DONE"
        : status === "BLOCKED"
          ? "ON_HOLD"
          : status;
  const index = TASK_STATUS_CYCLE.indexOf(normalized);
  return TASK_STATUS_CYCLE[(index + 1 + TASK_STATUS_CYCLE.length) % TASK_STATUS_CYCLE.length];
}

export function taskStatusMutationFields(value, task = {}) {
  const statusCode = String(value || "NOT_STARTED").toUpperCase() === "COMPLETED"
    ? "DONE"
    : String(value || "NOT_STARTED").toUpperCase();
  return statusCode === "DONE"
    ? { status_code: statusCode, progress_percent: 100 }
    : statusCode === "NOT_STARTED" || (["DONE", "COMPLETED"].includes(task.statusCode) && Number(task.progressPercent) === 100)
      ? { status_code: statusCode, progress_percent: 0 }
      : { status_code: statusCode };
}

export function nextTaskResponsibleOrgCode(value) {
  const index = TASK_OWNER_CYCLE.indexOf(String(value || "").toUpperCase());
  return TASK_OWNER_CYCLE[(index + 1 + TASK_OWNER_CYCLE.length) % TASK_OWNER_CYCLE.length];
}

// 업무 화면의 프레임은 프로젝트별 권한 캐시로 갈라지지 않는다.
// 내부 계정에는 동일한 조작 UI를 제공하고 실제 변경 권한은 서버가 다시 검증한다.
export function canOperateProjectTasks({ live, role, loginEnabled = true } = {}) {
  if (!live) return false;
  if (loginEnabled === false) return true;
  return role === "pocket" || role === "ns";
}

export function taskDateRangePreset(preset = "NEXT_7", todayValue = new Date()) {
  if (preset === "UNSCHEDULED") return { planned_start_date: "", due_date: "" };
  const iso = typeof todayValue === "string" ? todayValue.slice(0, 10) : (() => {
    const parts = new Intl.DateTimeFormat("en", {timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(todayValue);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  })();
  const start = new Date(`${iso}T12:00:00`);
  const end = new Date(start);
  if (preset === "LAST_7") start.setDate(start.getDate() - 6);
  else if (preset === "THIS_WEEK" || preset === "NEXT_WEEK") {
    const offset = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - offset + (preset === "NEXT_WEEK" ? 7 : 0));
    end.setTime(start.getTime());
    end.setDate(end.getDate() + 6);
  } else end.setDate(end.getDate() + 6);
  const format = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
  return { planned_start_date: format(start), due_date: format(end) };
}

export function taskDateRangeDuration(fields = {}) {
  if (!fields.planned_start_date || !fields.due_date) return null;
  const start = new Date(`${fields.planned_start_date}T12:00:00Z`).getTime();
  const end = new Date(`${fields.due_date}T12:00:00Z`).getTime();
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? Math.round((end - start) / 86400000) + 1 : null;
}

export function taskCreateValidationError(fields = {}) {
  if (!TASK_WORKSTREAM_CODES.has(normalizeTaskWorkstreamCode(fields.workstream_code))) return "업무 분야를 선택해 주세요.";
  if (!["POCKET", "NS", "CLIENT"].includes(String(fields.responsible_org_code || "").toUpperCase())) return "담당을 선택해 주세요.";
  if (!TASK_STATUS_CYCLE.includes(String(fields.status_code || "").toUpperCase())) return "현재 상태를 선택해 주세요.";
  if (Boolean(fields.planned_start_date) !== Boolean(fields.due_date)) return "시작일과 종료일을 함께 선택하거나 일정 미정을 선택해 주세요.";
  if (fields.planned_start_date && taskDateRangeDuration(fields) === null) return "종료일은 시작일과 같거나 이후여야 합니다.";

  if (fields.completion_url) {
    try { if (new URL(fields.completion_url).protocol !== "https:") return "완료링크는 https:// 주소를 입력해 주세요."; }
    catch { return "올바른 완료링크 주소를 입력해 주세요."; }
  }
  return "";
}

export function taskCreateInitialFields(role, mode = "default", todayValue = new Date()) {
  const responsibleOrgCode = role === "ns" ? "NS" : role === "client" ? "CLIENT" : "POCKET";
  return {
    title: "",
    category_code: "",
    phase_code: "M1",
    workstream_code: "MARKETING",
    responsible_org_code: responsibleOrgCode,
    status_code: mode === "completed" ? "DONE" : "NOT_STARTED",
    priority_code: "NORMAL",
    description: "",
    ...taskDateRangePreset(mode === "completed" ? "LAST_7" : "NEXT_7", todayValue),
    progress_percent: mode === "completed" ? 100 : 0,
    completion_url: "",
    remarks: "",
    visibility_code: role === "client" ? "CLIENT" : "PROJECT_TEAM",
  };
}

export function taskCreateSubmissionFields(fields) {
  const cleaned = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== ""));
  cleaned.title = String(fields.title || "").trim() || "제목 없는 업무";
  if (cleaned.workstream_code) cleaned.workstream_code = normalizeTaskWorkstreamCode(cleaned.workstream_code);
  delete cleaned.progress_percent;
  if (cleaned.status_code === "DONE") cleaned.progress_percent = 100;
  if (cleaned.planned_start_date && cleaned.due_date) cleaned.schedule_dates_json = serializeScheduleDates(scheduleDateRange(cleaned.planned_start_date, cleaned.due_date));
  return { ...cleaned, reviewer_org_code: "POCKET" };
}

export function taskUpdateInitialFields(task = {}) {
  return {
    originalSchedule: { start: task.plannedStartDate || "", end: task.dueDate || "", dates: taskScheduleDates(task) },
    category_code: task.categoryCode || task.category_code || "",
    title: task.title || "",
    status_code: task.statusCode === "COMPLETED" ? "DONE" : task.statusCode || "NOT_STARTED",
    description: task.description || "",
    planned_start_date: task.plannedStartDate || "",
    due_date: task.dueDate || "",
    progress_percent: task.progressPercent ?? 0,
    completion_url: task.completionUrl || "",
    remarks: task.remarks || "",
    priority_code: task.priorityCode || "NORMAL",
    responsible_org_code: task.responsibleOrgCode || "POCKET",
  };
}

export function taskUpdateSubmissionFields(fields = {}) {
  const plannedStartDate = fields.planned_start_date || "";
  const dueDate = fields.due_date || "";
  return {
    ...(Object.prototype.hasOwnProperty.call(fields, "category_code") ? { category_code: String(fields.category_code || "").trim().toUpperCase() } : {}),
    title: String(fields.title || "").trim(),
    status_code: String(fields.status_code || "NOT_STARTED").toUpperCase(),
    description: fields.description || "",
    planned_start_date: plannedStartDate,
    due_date: dueDate,
    schedule_dates_json: fields.originalSchedule && fields.originalSchedule.start === plannedStartDate && fields.originalSchedule.end === dueDate
      ? serializeScheduleDates(fields.originalSchedule.dates)
      : plannedStartDate && dueDate
      ? serializeScheduleDates(scheduleDateRange(plannedStartDate, dueDate))
      : null,

    completion_url: fields.completion_url || "",
    remarks: fields.remarks || "",
    priority_code: String(fields.priority_code || "NORMAL").toUpperCase(),
    responsible_org_code: String(fields.responsible_org_code || "POCKET").toUpperCase(),
  };
}
