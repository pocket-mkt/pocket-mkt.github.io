import { HubApiError } from "../api/errors.js";
export function createKpiDailyApi(client) {
  const call = async (name, args, signal) => {
    let request = client.rpc(name, args);
    if (signal) request = request.abortSignal(signal);
    const { data, error } = await request;
    if (error) {
      const code =
        error.code === "42501"
          ? "forbidden"
          : error.code === "40001"
            ? "conflict"
            : error.code;
      throw new HubApiError(
        code === "forbidden"
          ? "이 프로젝트의 데일리 KPI 접근 권한이 없습니다."
          : code === "conflict"
            ? "다른 사용자가 수정했습니다. 현재 입력은 유지됩니다. 최신 기록과 비교 후 다시 입력해 주세요."
            : code === "22023"
              ? "날짜·입력값·데이터 출처를 확인하세요."
              : "저장·조회하지 못했습니다. 현재 입력은 유지됩니다.",
        { code },
      );
    }
    return { ok: true, data };
  };
  return {
    read: ({ projectId, month, signal }) =>
      call(
        "read_kpi_daily",
        { p_project_id: projectId, p_month: month + "-01" },
        signal,
      ),
    save: ({ projectId, kind, date, body, rowVersion, mutationId }) =>
      call("save_kpi_daily", {
        p_project_id: projectId,
        p_kind: kind,
        p_date: date,
        p_body: body,
        p_expected_version: rowVersion ?? null,
        p_mutation_id: mutationId,
      }),
    history: ({ projectId, kind, date, beforeId, signal }) =>
      call(
        "read_kpi_daily_history",
        {
          p_project_id: projectId,
          p_kind: kind,
          p_date: date,
          p_before_id: beforeId ?? null,
        },
        signal,
      ),
  };
}
