import test from 'node:test';
import assert from 'node:assert/strict';
import { taskCopyFields, createTaskCopyPlan, runTaskCopyPlan } from '../src/taskCopy.js';

test('copy preserves sparse dates and reusable fields, not identity or completion history', () => {
  const task = { id: 9, title: '쇼츠', streamCode: 'MKT', categoryCode: 'YOUTUBE', responsibleOrgCode: 'NS', plannedStartDate: '2026-09-01', dueDate: '2026-09-09', scheduleDates: ['2026-09-01', '2026-09-09'], visibilityCode: 'POCKET_ONLY', statusCode: 'DONE', completionUrl: 'https://example.com', overdueHoldRanges: [{start:'2026-09-02',end:'2026-09-08'}] };
  const before = structuredClone(task);
  const fields = taskCopyFields(task, 30);
  assert.deepEqual(task, before);
  assert.deepEqual(JSON.parse(fields.schedule_dates_json), task.scheduleDates);
  assert.equal(fields.status_code, 'NOT_STARTED');
  assert.equal(fields.workstream_code, 'MARKETING');
  assert.equal(fields.visibility_code, 'POCKET_ONLY');
  for (const key of ['id','completion_url','overdue_hold_ranges','source_task_id','created_at','row_version']) assert.equal(key in fields, false);
});

test('one selected row creates one mutation, retry reuses IDs and skips successful chunks', async () => {
  let id = 0;
  const plan = createTaskCopyPlan(Array.from({length: 42}, (_, i) => ({title: `업무 ${i}`})), 100, () => `copy-test-${++id}`);
  assert.equal(plan.mutations.length, 42);
  assert.equal(new Set(plan.mutations.map(m => m.mutationId)).size, 42);
  assert.equal(plan.mutations[41].fields.sort_order, 520);
  let failed;
  await assert.rejects(runTaskCopyPlan(plan, async chunk => { if (chunk.length === 2) { failed = chunk; throw Error('network'); } }));
  assert.equal(plan.offset, 40);
  let calls = 0;
  await runTaskCopyPlan(plan, async chunk => { calls++; assert.deepEqual(chunk, failed); });
  assert.equal(calls, 1);
  assert.equal(plan.offset, 42);
});

test('unscheduled copies stay unscheduled', () => {
  const copy = taskCopyFields({ title: '미정', scheduleDates: [] }, 10);
  assert.equal(copy.planned_start_date, null);
  assert.equal(copy.due_date, null);
  assert.deepEqual(JSON.parse(copy.schedule_dates_json), []);
});
