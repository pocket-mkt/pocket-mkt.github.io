export function checklistToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function checklistProjectRoute(project) { return String(project.navigation_id || project.id); }
export function checklistIsDone(item) { return item.is_complete ?? Boolean(item.completed_at); }
export function checklistDeadline(item, today = checklistToday()) {
  if (checklistIsDone(item) || !item.task_date) return null;
  if (item.task_date < today) return { kind: 'overdue', label: '기한 지남' };
  if (item.task_date === today) return { kind: 'today', label: '오늘 마감' };
  return null;
}
export function checklistBucket(item, now = Date.now()) {
  return item.completed_at && new Date(item.completed_at).getTime() <= now - 7 * 86400000 ? 'completed' : 'active';
}
export function checklistDraft(item, projectId) {
  return { date: item?.task_date || checklistToday(), title: item?.title || '', projectId: String(item?.project_id || projectId || ''), completed: item ? checklistIsDone(item) : false };
}
export function checklistCompletionRequest(item, completed, statusCode) {
  if (item.row_kind !== 'TASK') return checklistRequest({ ...checklistDraft(item), completed }, item);
  return { kind: 'TASK', projectId: item.project_id, id: item.source_id, rowVersion: item.row_version, mutationId: crypto.randomUUID(),
    body: { status_code: statusCode || (completed ? 'DONE' : 'IN_PROGRESS') }, snapshot: item };
}
export async function saveChecklistEntry(source, request) {
  if (request.kind !== 'TASK') return source.saveChecklist(request);
  const result = await source.mutate({ projectId: request.projectId, mutationId: request.mutationId,
    mutation: { entityType: 'TASK', operation: 'UPDATE', id: request.id, expectedRowVersion: request.rowVersion, fields: request.body } });
  const record = result.data.record || result.data.item;
  if (!record) throw new Error('업무 저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 시도해 주세요.');
  return { ...result, data: { item: { ...request.snapshot, row_kind: 'TASK', id: `task:${record.id ?? record.task_id}`,
    source_id: String(record.id ?? record.task_id), project_id: record.project_id, task_date: record.due_date,
    title: record.title, completed_at: record.completed_at, is_complete: record.status_code === 'DONE',
    status_code: record.status_code, row_version: record.row_version, execution_month: record.execution_month } } };
}
export function checklistRequest(draft, item = null) {
  return { kind: 'ITEM', id: item?.id || crypto.randomUUID(), projectId: Number(draft.projectId), rowVersion: item?.row_version ?? null, mutationId: crypto.randomUUID(), body: { date: draft.date, title: draft.title.trim(), completed: draft.completed } };
}
export function boardSegments(text = '') {
  return String(text).split(/(https?:\/\/[^\s<>]+)/gi).filter(Boolean).map(value => {
    try { const url = new URL(value); return { text: value, href: /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : null }; }
    catch { return { text: value, href: null }; }
  });
}
