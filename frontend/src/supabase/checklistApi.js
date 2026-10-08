import { HubApiError } from '../api/errors.js';

export function createChecklistApi(client) {
  async function call(name, args, signal) {
    let request = client.rpc(name, args);
    if (signal) request = request.abortSignal(signal);
    const { data, error } = await request;
    if (error) {
      const code = error.code === '42501' ? 'forbidden' : error.code === '40001' ? 'conflict' : error.code;
      throw new HubApiError(code === 'forbidden' ? '이 프로젝트의 체크리스트 권한이 없습니다.' : code === 'conflict' ? '다른 사람이 수정했습니다. 작성한 내용을 복사한 뒤 최신 내용을 확인해 주세요.' : ['22023','22007','22008','23514'].includes(code) ? '날짜·할 일·프로젝트와 입력 길이를 확인해 주세요.' : '요청 결과를 확인하지 못했습니다. 같은 내용으로 다시 시도해 주세요.', { code });
    }
    return { ok: true, generatedAt: new Date().toISOString(), data };
  }
  return {
    list: ({ projectId = null, bucket = 'active', cursor = null, limit = 10, signal } = {}) => call('read_checklist_feed', { p_project_id: projectId || null, p_bucket: bucket, p_cursor: cursor, p_limit: limit }, signal),
    board: ({ projectId, signal }) => call('read_checklist_board', { p_project_id: projectId }, signal),
    save: ({ kind = 'ITEM', projectId, id = null, body, rowVersion = null, mutationId, operation = 'SAVE' }) => call('save_workspace_checklist', { p_kind: kind, p_project_id: projectId, p_id: id, p_body: body, p_expected_version: rowVersion, p_mutation_id: mutationId, p_operation: operation }),
  };
}
