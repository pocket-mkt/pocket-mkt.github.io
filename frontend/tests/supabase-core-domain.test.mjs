import assert from "node:assert/strict";
import test from "node:test";

import { createSupabaseCoreDomainApi } from "../src/supabase/coreDomainApi.js";
import { legacyPermissionMirrorInput } from "../src/supabase/hybridApi.js";

function clientReturning(responses) {
  const calls = [];
  return {
    calls,
    rpc(name, args) {
      calls.push({ name, args });
      return Promise.resolve(responses[name] || { data: null, error: null });
    },
  };
}

test("Supabase bootstrap, 통합 관리, 회의록, KPI는 화면별 RPC 계약을 사용한다", async () => {
  const client = clientReturning({
    read_bootstrap: { data: { clients: [], projects: [], channels: [], currentUser: { userId: "USR-1" } }, error: null },
    read_operations_dashboard: { data: { projects: [], weekly_tasks: [], issues: [], meetings: [], range: { from: "2026-09-07", to: "2026-09-13" } }, error: null },
    read_daily_meetings: { data: { items: [], totalMatching: 0 }, error: null },
    read_performance: { data: { definitions: [], actuals: [], daily: [], channels: [] }, error: null },
  });
  const api = createSupabaseCoreDomainApi(client);
  await api.bootstrap();
  await api.operationsDashboard({ startDate: "2026-09-07", endDate: "2026-09-13" });
  await api.dailyMeetings({ projectId: "12", limit: 500 });
  await api.performance({ projectId: 12, startDate: "2026-09-01", endDate: "2026-09-03" });
  assert.deepEqual(client.calls.map((call) => call.name), ["read_bootstrap", "read_operations_dashboard", "read_daily_meetings", "read_performance"]);
  assert.deepEqual(client.calls[1].args, { p_from: "2026-09-07", p_to: "2026-09-13" });
  assert.equal(client.calls[2].args.p_limit, 200);
  assert.equal(client.calls[3].args.p_start_date, "2026-09-01");
});
test("회의록, KPI, 이슈 저장은 mutation id, row version, 프로젝트를 RPC에 고정한다", async () => {
  const client = clientReturning({
    mutate_daily_meeting: { data: { ok: true, data: { item: { meeting_id: 3 } } }, error: null },
    mutate_kpi_definition: { data: { ok: true, data: { item: { kpi_id: 4 } } }, error: null },
    mutate_project_issue: { data: { ok: true, data: { item: { issue_id: 5 } } }, error: null },
  });
  const api = createSupabaseCoreDomainApi(client);
  await api.mutateMeeting({ projectId: "9", mutationId: "meeting_12345678", mutation: { entityType: "daily_meeting", operation: "CREATE", fields: { title: "회의" } } });
  await api.mutateKpi({ projectId: "9", mutationId: "kpi_12345678", expectedRowVersion: 7, mutation: { entityType: "kpi_definition", operation: "UPDATE", id: 4, fields: { target_value: 10 } } });
  await api.mutateIssue({ projectId: "9", mutationId: "issue_12345678", expectedRowVersion: 2, mutation: { entityType: "project_issue", operation: "UPDATE", id: 5, fields: { status_code: "DONE" } } });
  assert.deepEqual(client.calls[0].args, {
    p_mutation_id: "meeting_12345678", p_operation: "CREATE", p_project_id: "9",
    p_meeting_id: null, p_expected_row_version: null, p_fields: { title: "회의" },
  });
  assert.equal(client.calls[1].args.p_kpi_id, "4");
  assert.equal(client.calls[1].args.p_expected_row_version, "7");
  assert.equal(client.calls[2].name, "mutate_project_issue");
  assert.equal(client.calls[2].args.p_issue_id, "5");
  assert.equal(client.calls[2].args.p_expected_row_version, "2");
});

test("도메인 RPC의 애플리케이션 오류는 저장 성공으로 처리하지 않는다", async () => {
  const client = clientReturning({
    mutate_kpi_definition: { data: { ok: false, error: { code: "stale_row_version", message: "stale" } }, error: null },
  });
  const api = createSupabaseCoreDomainApi(client);
  await assert.rejects(
    api.mutateKpi({ projectId: 1, mutationId: "kpi_abcdefgh", expectedRowVersion: 2, mutation: { operation: "UPDATE", id: 3, fields: { target_value: 10 } } }),
    (error) => error.code === "conflict",
  );
});

test("프로젝트 생성은 회사·프로젝트·기간을 단일 RPC 계약으로 전달한다", async () => {
  const client = clientReturning({
    create_project: { data: { ok: true, data: { client: { client_id: "CLT-NEW" }, project: { project_id: "PRJ-NEW" } } }, error: null },
  });
  const api = createSupabaseCoreDomainApi(client);
  const result = await api.createProject({
    mutationId: "project_12345678",
    fields: {
      client_name: "신규 고객사",
      project_name: "신규 프로젝트",
      description: "운영 범위",
      start_date: "2026-09-03",
      end_date: "2026-12-31",
    },
  });
  assert.equal(result.data.project.project_id, "PRJ-NEW");
  assert.deepEqual(client.calls[0], {
    name: "create_project",
    args: {
      p_mutation_id: "project_12345678",
      p_client_name: "신규 고객사",
      p_project_name: "신규 프로젝트",
      p_description: "운영 범위",
      p_start_date: "2026-09-03",
      p_end_date: "2026-12-31",
    },
  });
});

test("견적 프로젝트와 기존 프로젝트 추가는 전용 원자적 RPC를 사용한다", async () => {
  const client = clientReturning({
    create_project_from_quote: { data: { ok: true, data: { client: { client_id: "CLT-Q" }, project: { project_id: "PRJ-Q" } } }, error: null },
    import_quote_tasks: { data: { ok: true, data: { imported_task_count: 1 } }, error: null },
  });
  const api = createSupabaseCoreDomainApi(client);
  const task = { title: "유튜브 운영", workstream_code: "VIDEO" };
  await api.createProject({ mutationId: "quote_project_123", fields: { client_name: "고객사", project_name: "캠페인" }, quote: { total: 10 }, tasks: [task] });
  await api.importQuoteTasks({ mutationId: "quote_append_123", projectId: 7, quote: { total: 10 }, tasks: [task] });
  assert.equal(client.calls[0].name, "create_project_from_quote");
  assert.deepEqual(client.calls[0].args.p_tasks, [task]);
  assert.deepEqual(client.calls[0].args.p_quote_data, { total: 10 });
  assert.equal(client.calls[1].name, "import_quote_tasks");
  assert.equal(client.calls[1].args.p_project_id, "7");
});

test("고객 권한의 Sheets 호환 복제는 Supabase membership id를 넘기지 않는다", () => {
  assert.deepEqual(legacyPermissionMirrorInput({
    operation: "UPSERT",
    account: { account: "client", projectId: "PRJ-1", membershipId: "42", allowedPages: ["tasks"] },
  }), {
    operation: "UPSERT",
    account: { account: "client", projectId: "PRJ-1", allowedPages: ["tasks"] },
    fields: undefined,
  });
});
