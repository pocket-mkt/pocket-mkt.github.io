import { HubApiError } from "../api/errors.js";
import { createMutationId } from "../api/hubApi.js";

function positiveId(value, label) {
  const normalized = String(value ?? "").trim();
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new HubApiError(`${label} 식별자가 올바르지 않습니다.`, {
      code: "invalid_supabase_id",
      action: "project_credentials",
      retriable: false,
    });
  }
  return normalized;
}

function credentialError(error, action, fallback) {
  const status = Number(error?.status || error?.statusCode) || null;
  const rawCode = String(error?.code || "supabase_rpc_error");
  const code = rawCode === "42501" ? "forbidden" : rawCode === "40001" ? "conflict" : rawCode;
  const knownMessage = {
    forbidden: "이 프로젝트의 아이디 관리대장에 접근할 권한이 없습니다.",
    P0002: "등록된 계정 정보를 찾지 못했습니다.",
    22023: "사이트·아이디·비밀번호 입력값을 확인해 주세요.",
  }[code];
  return new HubApiError(knownMessage || fallback, {
    code,
    status,
    action,
    retriable: status === null || [429, 500, 502, 503, 504].includes(status),
    cause: error,
  });
}

async function rpc(client, name, args, { signal, fallback, validate }) {
  let request = client.rpc(name, args);
  if (signal && typeof request?.abortSignal === "function") request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw credentialError(error, name, fallback);
  if (validate && !validate(data)) {
    throw new HubApiError("아이디 관리대장 응답 형식이 올바르지 않습니다.", {
      code: "invalid_contract",
      action: name,
      retriable: false,
    });
  }
  return data;
}

export function credentialMutationArguments(input = {}) {
  const mutation = input.mutation || {};
  const operation = String(mutation.operation || "").toUpperCase();
  if (!["CREATE", "UPDATE", "ARCHIVE"].includes(operation)) {
    throw new HubApiError("지원하지 않는 계정 관리 작업입니다.", {
      code: "unsupported_operation",
      action: "mutate_project_credential",
      retriable: false,
    });
  }
  const create = operation === "CREATE";
  return {
    p_mutation_id: String(input.mutationId || mutation.mutationId || createMutationId("credential")),
    p_operation: operation,
    p_project_id: positiveId(input.projectId ?? mutation.projectId, "프로젝트"),
    p_credential_id: create ? null : positiveId(mutation.id, "계정"),
    p_expected_row_version: create ? null : positiveId(input.expectedRowVersion ?? mutation.expectedRowVersion, "행 버전"),
    p_fields: mutation.fields || {},
  };
}

export function createSupabaseCredentialLedger(client) {
  if (!client || typeof client.rpc !== "function") throw new TypeError("A Supabase client with rpc() is required");
  return Object.freeze({
    async read(params = {}) {
      const data = await rpc(client, "read_project_credentials", {
        p_project_id: positiveId(params.projectId, "프로젝트"),
      }, {
        signal: params.signal,
        fallback: "아이디 관리대장을 불러오지 못했습니다.",
        validate: (value) => value && Array.isArray(value.items) && !JSON.stringify(value.items).includes("password_secret_id"),
      });
      return { ok: true, generatedAt: new Date().toISOString(), data };
    },
    async reveal(params = {}) {
      const data = await rpc(client, "reveal_project_credential", {
        p_project_id: positiveId(params.projectId, "프로젝트"),
        p_credential_id: positiveId(params.credentialId, "계정"),
      }, {
        signal: params.signal,
        fallback: "비밀번호를 확인하지 못했습니다.",
        validate: (value) => value && String(value.credentialId || "") === String(params.credentialId) && typeof value.password === "string",
      });
      return { ok: true, generatedAt: new Date().toISOString(), data };
    },
    async mutate(input = {}) {
      const data = await rpc(client, "mutate_project_credential", credentialMutationArguments(input), {
        signal: input.signal,
        fallback: "계정 정보를 저장하지 못했습니다.",
        validate: (value) => value?.ok === true && value?.data?.item?.credential_id,
      });
      return { ok: true, generatedAt: new Date().toISOString(), data: data.data };
    },
  });
}
