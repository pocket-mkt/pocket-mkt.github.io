import { HubApiError } from "../api/errors.js";
export function createKpiFunnelApi(client) {
  const call = async (name, args, signal) => {
    let q = client.rpc(name, args);
    if (signal) q = q.abortSignal(signal);
    const { data, error } = await q;
    if (error) {
      const code =
        error.code === "42501"
          ? "forbidden"
          : error.code === "40001"
            ? "conflict"
            : error.code;
      throw new HubApiError(
        code === "forbidden"
          ? "이 프로젝트의 KPI 접근 권한이 없습니다."
          : code === "conflict"
            ? "다른 사용자가 수정했습니다. 입력값을 확인한 후 최신 내용을 다시 불러오세요."
            : error.code === "22023"
              ? "입력값을 확인해 주세요. 전환 수는 유입 수보다 클 수 없습니다."
              : "저장·조회하지 못했습니다. 입력값은 유지됩니다.",
        { code },
      );
    }
    return { ok: true, data };
  };
  return {
    read: ({ projectId, month, signal }) =>
      call(
        "read_kpi_funnel",
        { p_project_id: projectId, p_month: month + "-01" },
        signal,
      ),
    save: ({ projectId, month, body, rowVersion, mutationId }) =>
      call("save_kpi_funnel", {
        p_project_id: projectId,
        p_month: month + "-01",
        p_body: body,
        p_expected_version: rowVersion ?? null,
        p_mutation_id: mutationId,
      }),
  };
}
