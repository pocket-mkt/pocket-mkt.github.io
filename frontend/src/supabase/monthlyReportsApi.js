import { HubApiError } from '../api/errors.js';

export function createMonthlyReportsApi(client) {
  const call = async (name, args, signal) => {
    let query = client.rpc(name, args);
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;
    if (error) {
      const code = error.code === '42501' ? 'forbidden' : error.code === '40001' ? 'conflict' : error.code;
      throw new HubApiError(code === 'forbidden' ? '이 프로젝트의 보고서 접근 권한이 없습니다.' : code === 'conflict' ? '다른 사용자가 보고서를 변경했습니다. 최신 월 목록을 확인한 뒤 다시 업로드해 주세요.' : error.code === '22023' ? '월·제목·HTML 파일을 확인해 주세요. 최대 3MB입니다.' : '보고서 요청에 실패했습니다. 다시 시도해 주세요.', { code });
    }
    return { ok: true, generatedAt: new Date().toISOString(), data };
  };
  return {
    list: ({ projectId, beforeMonth, signal }) => call('list_monthly_reports', { p_project_id: projectId, p_before_month: beforeMonth ? `${beforeMonth}-01` : null }, signal),
    read: ({ projectId, month, signal }) => call('read_monthly_report', { p_project_id: projectId, p_month: `${month}-01` }, signal),
    save: ({ projectId, month, title, fileName, html, published = true, rowVersion, mutationId, operation = 'SAVE' }) => call('save_monthly_report', {
      p_project_id: projectId, p_month: `${month}-01`, p_title: title || '', p_file_name: fileName || '', p_html: html ?? null,
      p_published: published, p_expected_version: rowVersion ?? null, p_mutation_id: mutationId, p_operation: operation,
    }),
  };
}
