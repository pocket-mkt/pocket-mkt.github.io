import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTaskExecutionMonth,
  shiftTaskMonth,
  taskMonthOptions,
  tasksForExecutionMonths,
  toggleTaskMonth,
} from "../src/taskMonth.js";

test("execution month normalizes to the first day", () => {
  assert.equal(normalizeTaskExecutionMonth("2026-10"), "2026-10-01");
  assert.equal(shiftTaskMonth("2026-01", -1), "2025-12");
});

test("month selection uses only the stored month, including unfinished and cross-month completed tasks", () => {
  const tasks = [
    { id: 1, executionMonth: "2026-09-01", statusCode: "IN_PROGRESS", dueDate: "2026-09-25" },
    { id: 2, executionMonth: "2026-10-01", statusCode: "NOT_STARTED", dueDate: "2026-10-10" },
    { id: 3, executionMonth: "2026-09-01", statusCode: "DONE", completedDate: "2026-09-28", dueDate: "2026-09-28" },
    { id: 4, executionMonth: "2026-09-01", statusCode: "DONE", completedDate: "2026-10-02", dueDate: "2026-10-02" },
  ];
  const before = structuredClone(tasks);
  assert.deepEqual(tasksForExecutionMonths(tasks, new Set(["2026-10"])).map((task) => task.id), [2]);
  assert.deepEqual(tasksForExecutionMonths(tasks, new Set(["2026-09"])).map((task) => task.id), [1, 3, 4]);
  assert.deepEqual(tasksForExecutionMonths(tasks, new Set(["2026-09", "2026-10"])).map((task) => task.id), [1, 2, 3, 4]);
  assert.deepEqual(tasksForExecutionMonths(tasks, new Set()), []);
  assert.deepEqual(tasks, before);
});

test("month buttons toggle independently without changing previous selection", () => {
  const october = new Set(["2026-10"]);
  const both = toggleTaskMonth(october, "2026-09");
  assert.deepEqual([...both].sort(), ["2026-09", "2026-10"]);
  assert.deepEqual([...october], ["2026-10"]);
  const september = toggleTaskMonth(both, "2026-10");
  assert.deepEqual([...september], ["2026-09"]);
  assert.equal(toggleTaskMonth(september, "2026-09").size, 0);
});

test("month buttons include previous, current and stored execution months", () => {
  const options = taskMonthOptions([{ executionMonth: "2026-08-01" }], "2026-10-01");
  assert.deepEqual(options, ["2026-08", "2026-09", "2026-10"]);
});
