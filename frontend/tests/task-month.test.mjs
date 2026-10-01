import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTaskExecutionMonth,
  shiftTaskMonth,
  taskMonthOptions,
  taskMonthRelation,
  tasksForExecutionMonth,
} from "../src/taskMonth.js";

test("execution month normalizes to the first day", () => {
  assert.equal(normalizeTaskExecutionMonth("2026-10"), "2026-10-01");
  assert.equal(shiftTaskMonth("2026-01", -1), "2025-12");
});

test("selected month keeps its tasks and unfinished carryovers without duplicating records", () => {
  const tasks = [
    { id: 1, executionMonth: "2026-09-01", statusCode: "IN_PROGRESS", dueDate: "2026-09-25" },
    { id: 2, executionMonth: "2026-10-01", statusCode: "NOT_STARTED", dueDate: "2026-10-10" },
    { id: 3, executionMonth: "2026-09-01", statusCode: "DONE", completedDate: "2026-09-28", dueDate: "2026-09-28" },
    { id: 4, executionMonth: "2026-09-01", statusCode: "DONE", completedDate: "2026-10-02", dueDate: "2026-10-02" },
  ];
  assert.equal(taskMonthRelation(tasks[0], "2026-10"), "CARRYOVER");
  assert.equal(taskMonthRelation(tasks[1], "2026-10"), "CURRENT");
  assert.equal(taskMonthRelation(tasks[2], "2026-10"), null);
  assert.equal(taskMonthRelation(tasks[3], "2026-10"), "CARRYOVER");
  assert.deepEqual(tasksForExecutionMonth(tasks, "2026-10").map((task) => task.id), [1, 2, 4]);
  assert.deepEqual(tasksForExecutionMonth(tasks, "2026-09").map((task) => task.id), [1, 3, 4]);
});

test("month buttons include previous, current and stored execution months", () => {
  const options = taskMonthOptions([{ executionMonth: "2026-08-01" }], "2026-10-01");
  assert.deepEqual(options, ["2026-08", "2026-09", "2026-10"]);
});
