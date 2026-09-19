import { serializeScheduleDates, taskScheduleDates } from "./taskGantt.js";
import { normalizeTaskWorkstreamCode } from "./taskForm.js";

// Allowlist only reusable task data; never clone identity or completion/hold history.
export function taskCopyFields(task, sortOrder) {
  return {
    title: task.title || "제목 없는 업무",
    description: task.description || "",
    category_code: task.categoryCode || "",
    phase_code: task.phaseCode || "M1",
    workstream_code: normalizeTaskWorkstreamCode(task.streamCode || "MARKETING"),
    responsible_org_code: task.responsibleOrgCode || "POCKET",
    reviewer_org_code: "POCKET",
    priority_code: task.priorityCode || "NORMAL",
    planned_start_date: task.plannedStartDate || null,
    due_date: task.dueDate || null,
    schedule_dates_json: serializeScheduleDates(taskScheduleDates(task)),
    status_code: "NOT_STARTED",
    progress_percent: 0,
    visibility_code: task.visibilityCode || "PROJECT_TEAM",
    remarks: task.remarks || "",
    sort_order: sortOrder,
  };
}

export function createTaskCopyPlan(tasks, lastOrder, makeId = () => crypto.randomUUID()) {
  return { offset: 0, mutations: tasks.map((task, index) => ({
    mutationId: makeId(), entityType: "task", operation: "CREATE",
    fields: taskCopyFields(task, lastOrder + (index + 1) * 10),
  })) };
}

export async function runTaskCopyPlan(plan, save) {
  while (plan.offset < plan.mutations.length) {
    const chunk = plan.mutations.slice(plan.offset, plan.offset + 40);
    await save(chunk);
    plan.offset += chunk.length;
  }
}
