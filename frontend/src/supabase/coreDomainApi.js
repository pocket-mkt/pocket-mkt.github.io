import { HubApiError } from "../api/errors.js";
import { createMutationId } from "../api/hubApi.js";

function positiveId(value, label = "항목") {
  const normalized = String(value ?? "").trim();
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new HubApiError(`${label} 식별자가 올바르지 않습니다.`, {
      code: "invalid_supabase_id",
      action: "supabase_domain",
      retriable: false,
    });
  }
  return normalized;
}
function rpcError(error, action, fallback) {
  const status = Number(error?.status || error?.statusCode) || null;
  const rawCode = String(error?.code || "supabase_rpc_error");
  const code = rawCode === "42501" ? "forbidden" : rawCode === "40001" ? "conflict" : rawCode;
  return new HubApiError(code === "forbidden" ? "이 화면에 접근할 권한이 없습니다." : fallback, {
    code,
    status,
    action,
    retriable: status === null || [429, 500, 502, 503, 504].includes(status),
    cause: error,
  });
}

async function rpc(client, name, args, { signal, validate, fallback }) {
  let request = client.rpc(name, args);
  if (signal && typeof request?.abortSignal === "function") request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw rpcError(error, name, fallback);
  if (validate && !validate(data)) {
    throw new HubApiError("Supabase 응답 계약이 올바르지 않습니다.", {
      code: "invalid_contract",
      action: name,
      retriable: false,
    });
  }
  return data;
}

function mutationArgs(input, idKey) {
  const mutation = input.mutation || {};
  const operation = String(mutation.operation || "").toUpperCase();
  if (!["CREATE", "UPDATE", "ARCHIVE"].includes(operation)) {
    throw new HubApiError("지원하지 않는 저장 작업입니다.", { code: "unsupported_operation", retriable: false });
  }
  const create = operation === "CREATE";
  return {
    p_mutation_id: String(input.mutationId || mutation.mutationId || createMutationId()),
    p_operation: operation,
    p_project_id: positiveId(input.projectId ?? mutation.projectId, "프로젝트"),
    [idKey]: create ? null : positiveId(mutation.id, "항목"),
    p_expected_row_version: create ? null : positiveId(input.expectedRowVersion ?? mutation.expectedRowVersion, "행 버전"),
    p_fields: mutation.fields || mutation.values || {},
  };
}

async function mutate(client, name, args, fallback) {
  const data = await rpc(client, name, args, { fallback });
  if (!data?.ok) {
    const code = data?.error?.code === "stale_row_version" ? "conflict" : String(data?.error?.code || "save_failed");
    throw new HubApiError(data?.error?.message || fallback, {
      code,
      action: name,
      retriable: code === "mutation_in_progress",
    });
  }
  return { ok: true, generatedAt: data.generatedAt || new Date().toISOString(), data: data.data || {} };
}

export function createSupabaseCoreDomainApi(client) {
  if (!client || typeof client.rpc !== "function") throw new TypeError("A Supabase client with rpc() is required");
  return Object.freeze({
    async bootstrap(params = {}) {
      const data = await rpc(client, "read_bootstrap", {}, {
        signal: params.signal,
        fallback: "프로젝트 목록을 불러오지 못했습니다.",
        validate: (value) => value && Array.isArray(value.clients) && Array.isArray(value.projects) && value.currentUser,
      });
      return { ok: true, generatedAt: new Date().toISOString(), data };
    },
    async dailyMeetings(params = {}) {
      const data = await rpc(client, "read_daily_meetings", {
        p_project_id: positiveId(params.projectId, "프로젝트"),
        p_limit: Math.max(1, Math.min(Number(params.limit) || 100, 200)),
      }, {
        signal: params.signal,
        fallback: "회의록을 불러오지 못했습니다.",
        validate: (value) => value && Array.isArray(value.items),
      });
      return { ok: true, generatedAt: new Date().toISOString(), data };
    },
    async operationsDashboard(params = {}) {
      const data = await rpc(client, "read_operations_dashboard", {
        p_from: params.startDate || null,
        p_to: params.endDate || null,
      }, {
        signal: params.signal,
        fallback: "통합 관리 데이터를 불러오지 못했습니다.",
        validate: (value) => value && Array.isArray(value.projects) && Array.isArray(value.weekly_tasks) && Array.isArray(value.issues) && Array.isArray(value.meetings),
      });
      return { ok: true, generatedAt: data.generated_at || new Date().toISOString(), data };
    },
    async performance(params = {}) {
      const data = await rpc(client, "read_performance", {
        p_project_id: positiveId(params.projectId, "프로젝트"),
        p_start_date: params.startDate || null,
        p_end_date: params.endDate || null,
      }, {
        signal: params.signal,
        fallback: "KPI를 불러오지 못했습니다.",
        validate: (value) => value && Array.isArray(value.definitions) && Array.isArray(value.actuals),
      });
      return { ok: true, generatedAt: new Date().toISOString(), data };
    },
    createProject: (input = {}) => {
      const fields = input.fields || {};
      const tasks = Array.isArray(input.tasks) ? input.tasks : [];
      const quote = input.quote && typeof input.quote === "object" ? input.quote : {};
      return mutate(client, tasks.length ? "create_project_from_quote" : "create_project", {
        p_mutation_id: String(input.mutationId || createMutationId("project")),
        p_client_name: String(fields.client_name || fields.clientName || "").trim(),
        p_project_name: String(fields.project_name || fields.projectName || "").trim(),
        p_description: String(fields.description || "").trim() || null,
        p_start_date: fields.start_date || fields.startDate || null,
        p_end_date: fields.end_date || fields.endDate || null,
        ...(tasks.length ? { p_quote_data: quote, p_tasks: tasks } : {}),
      }, "프로젝트를 생성하지 못했습니다.");
    },
    importQuoteTasks: (input = {}) => mutate(client, "import_quote_tasks", {
      p_mutation_id: String(input.mutationId || createMutationId("quote")),
      p_project_id: positiveId(input.projectId, "프로젝트"),
      p_quote_data: input.quote && typeof input.quote === "object" ? input.quote : {},
      p_tasks: Array.isArray(input.tasks) ? input.tasks : [],
    }, "견적 업무를 저장하지 못했습니다."),
    mutateMeeting: (input) => mutate(client, "mutate_daily_meeting", mutationArgs(input, "p_meeting_id"), "회의록을 저장하지 못했습니다."),
    mutateKpi: (input) => mutate(client, "mutate_kpi_definition", mutationArgs(input, "p_kpi_id"), "KPI를 저장하지 못했습니다."),
    mutateIssue: (input) => mutate(client, "mutate_project_issue", mutationArgs(input, "p_issue_id"), "이슈사항을 저장하지 못했습니다."),
  });
}
