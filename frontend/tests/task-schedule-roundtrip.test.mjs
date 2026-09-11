import assert from "node:assert/strict";
import test from "node:test";
import { tasksViewModel } from "../src/api/viewModel.js";
import { taskScheduleDates } from "../src/taskGantt.js";
import { taskUpdateInitialFields, taskUpdateSubmissionFields } from "../src/taskForm.js";

const hold = [{ startDate: "2026-09-03", endDate: "2026-09-10" }];
const base = {
  task_id: "T-gap", title: "콘텐츠 운영", status_code: "IN_PROGRESS",
  planned_start_date: "2026-09-01", due_date: "2026-09-15",
  overdue_hold_ranges: hold,
};
const taskFrom = (row) => tasksViewModel({ data: { items: [row] } }).items[0];

test("read and canonical save responses preserve sparse Gantt dates and hold history", () => {
  const dates = ["2026-09-01", "2026-09-11", "2026-09-15"];
  for (const shape of [{ schedule_dates_json: JSON.stringify(dates) }, { schedule_dates: dates }]) {
    const task = taskFrom({ ...base, ...shape });
    assert.deepEqual(taskScheduleDates(task), dates);
    assert.deepEqual(task.overdueHoldRanges, hold);
  }
});

test("a later click after save and a subsequent status edit do not fill intervening dates", () => {
  let dates = ["2026-09-01", "2026-09-11"];
  for (const laterDate of ["2026-09-15", "2026-09-18"]) {
    const saved = taskFrom({ ...base, due_date: dates.at(-1), schedule_dates: dates });
    const next = [...taskScheduleDates(saved), laterDate];
    dates = [...dates, laterDate];
    assert.deepEqual(next, dates);
    const response = taskFrom({ ...base, due_date: laterDate, schedule_dates: next });
    const fields = taskUpdateSubmissionFields({ ...taskUpdateInitialFields(response), status_code: "DONE" });
    assert.deepEqual(JSON.parse(fields.schedule_dates_json), dates);
  }
});

test("explicit empty dates stay erased, read field takes precedence, legacy ranges still work", () => {
  assert.deepEqual(taskScheduleDates(taskFrom({ ...base, schedule_dates: [] })), []);
  assert.deepEqual(taskScheduleDates(taskFrom({ ...base, schedule_dates_json: "[]", schedule_dates: ["2026-09-01"] })), []);
  assert.deepEqual(taskScheduleDates(taskFrom({ ...base, schedule_dates_json: null, schedule_dates: ["2026-09-01"] })), ["2026-09-01"]);
  assert.equal(taskScheduleDates(taskFrom(base)).length, 15);
});
