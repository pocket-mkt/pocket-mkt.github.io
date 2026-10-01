import { HubApiError } from "../api/errors.js";

function functionError(payload, status) {
  const code = String(payload?.error?.code || "access_admin_failed");
  const messages = {
    forbidden: "권한이 있는 포켓·NS 운영자만 고객 계정 권한을 관리할 수 있습니다.",
    invalid_input: "계정과 프로젝트 권한 입력값을 확인해 주세요.",
    not_found: "계정 또는 프로젝트 권한을 찾지 못했습니다.",
    conflict: "다른 운영자가 권한을 변경했습니다. 계정 화면을 다시 열어 확인해 주세요.",
  };
  return new HubApiError(messages[code] || payload?.error?.message || "권한 관리 요청에 실패했습니다.", {
    code,
    status,
    action: "access_admin",
    retriable: status >= 500 || status === 429,
  });
}

export function createSupabaseAccessAdmin(client) {
  async function invoke(body) {
    if (!client?.functions?.invoke) throw new TypeError("A Supabase client with functions.invoke() is required");
    const { data, error } = await client.functions.invoke("access-admin", { body });
    if (error || !data?.ok) {
      const contextStatus = Number(error?.context?.status || error?.status) || 500;
      let payload=data;
      if (!payload && error?.context?.json) {
        try {payload=await (error.context.clone?.() || error.context).json();} catch { /* Use the safe fallback below. */ }
      }
      throw functionError(payload || { error: { code: error?.name } }, contextStatus);
    }
    return { ok: true, generatedAt: data.generatedAt || new Date().toISOString(), data: data.data || {} };
  }
  return Object.freeze({ read: () => invoke({ operation: "READ" }), mutate: (input = {}) => invoke({ operation: input.operation || input.account?.operation || "UPSERT", account: input.account || input.fields || {} }) });
}
