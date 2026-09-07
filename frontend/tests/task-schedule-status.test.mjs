import assert from "node:assert/strict";
import test from "node:test";
import { effectiveTaskScheduleState, koreaDateValue, overdueTaskHoldRange } from "../src/taskScheduleStatus.js";

test("일정 자동 상태는 시작 전 미착수, 기간 중 진행, 종료일 다음 날 완료다", () => {
  const task = { status_mode: "SCHEDULE", status_code: "NOT_STARTED", planned_start_date: "2026-09-04", due_date: "2026-09-06", progress_percent: 35 };
  assert.deepEqual(effectiveTaskScheduleState(task, "2026-09-03"), { statusMode: "SCHEDULE", statusCode: "NOT_STARTED", progressPercent: 0, automatic: true });
  assert.deepEqual(effectiveTaskScheduleState(task, "2026-09-04"), { statusMode: "SCHEDULE", statusCode: "IN_PROGRESS", progressPercent: 33, automatic: true });
  assert.deepEqual(effectiveTaskScheduleState(task, "2026-09-06"), { statusMode: "SCHEDULE", statusCode: "IN_PROGRESS", progressPercent: 100, automatic: true });
  assert.deepEqual(effectiveTaskScheduleState(task, "2026-09-07"), { statusMode: "SCHEDULE", statusCode: "DONE", progressPercent: 100, automatic: true });
});

test("만료 업무도 수동 보류는 유지하고 다른 수동 상태는 완료 처리한다", () => {
  const task = { statusMode: "MANUAL", statusCode: "ON_HOLD", plannedStartDate: "2026-09-01", dueDate: "2026-09-06", progressPercent: 40 };
  assert.equal(effectiveTaskScheduleState(task, "2026-09-04").statusCode, "ON_HOLD");
  assert.deepEqual(effectiveTaskScheduleState(task, "2026-09-07"), { statusMode: "MANUAL", statusCode: "ON_HOLD", progressPercent: 40, automatic: false });
  assert.equal(effectiveTaskScheduleState({ ...task, statusCode: "IN_PROGRESS" }, "2026-09-07").statusCode, "DONE");
});

test("한국 날짜 계산은 UTC 자정 경계와 무관하게 서울 날짜를 쓴다", () => {
  assert.equal(koreaDateValue(new Date("2026-09-03T16:00:00Z")), "2026-09-04");
});

test("DB 마이그레이션 전 status_mode가 없는 행은 수동 상태를 보존한다", () => {
  const task = { status_code: "ON_HOLD", planned_start_date: "2026-09-01", due_date: "2026-09-06", progress_percent: 40 };
  assert.deepEqual(effectiveTaskScheduleState(task, "2026-09-04"), { statusMode: "MANUAL", statusCode: "ON_HOLD", progressPercent: 40, automatic: false });
});

test("기한 초과 보류 구간은 진행 중이면 오늘까지, 완료되면 해제일에서 멈춘다", () => {
  assert.deepEqual(overdueTaskHoldRange({ statusCode: "ON_HOLD", dueDate: "2026-09-03" }, "2026-09-07"), {
    startDate: "2026-09-04",
    endDate: "2026-09-07",
    live: true,
  });
  assert.deepEqual(overdueTaskHoldRange({ statusCode: "DONE", dueDate: "2026-09-03", overdueHoldResolvedAt: "2026-09-06T16:00:00Z" }, "2026-09-09"), {
    startDate: "2026-09-04",
    endDate: "2026-09-07",
    live: false,
  });
  assert.equal(overdueTaskHoldRange({ statusCode: "DONE", dueDate: "2026-09-03", completedAt: "2026-09-07T00:00:00Z" }, "2026-09-09"), null);
});
