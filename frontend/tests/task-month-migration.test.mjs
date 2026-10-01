import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL("../../supabase/migrations/20261001014940_task_execution_month.sql", import.meta.url);

test("execution month migration keeps audited writes and safe projections", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /add column execution_month date/i);
  assert.match(sql, /tasks_execution_month_first_day_chk/i);
  assert.match(sql, /private\.mutate_task/i);
  assert.match(sql, /private\.read_tasks/i);
  assert.match(sql, /private\.read_client_progress/i);
  assert.match(sql, /execution_month = case when p_fields/i);
  assert.doesNotMatch(sql, /grant\s+(select|insert|update|delete)\s+on\s+public\.tasks/i);
});
