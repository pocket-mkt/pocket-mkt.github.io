export function checklistToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function checklistProjectRoute(project) { return String(project.navigation_id || project.id); }
export const CHECKLIST_DIRECTIONS = Object.freeze([
  { value: 'POCKET_TO_NS', label: '포켓 → NS', receiver: 'NS 업무', tone: 'ns' },
  { value: 'NS_TO_POCKET', label: 'NS → 포켓', receiver: '포켓 업무', tone: 'pocket' },
]);
export function checklistDirection(value) { return CHECKLIST_DIRECTIONS.find(d => d.value === value) || { label: '방향 미지정', receiver: '수정에서 선택', tone: 'unassigned' }; }
export function checklistIsDone(item) { return Boolean(item.completed_at); }
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
  return { date: item?.task_date || checklistToday(), title: item?.title || '', projectId: String(item?.project_id || projectId || ''), completed: item ? checklistIsDone(item) : false, direction: item?.request_direction || '' };
}
export function checklistCompletionRequest(item, completed) {
  return checklistRequest({ ...checklistDraft(item), completed }, item);
}
export async function saveChecklistEntry(source, request) {
  if (!['ITEM', 'BOARD'].includes(request.kind)) throw new Error('체크리스트 요청만 저장할 수 있습니다.');
  return source.saveChecklist(request);
}
export function checklistRequest(draft, item = null) {
  if (item?.row_kind === 'TASK') throw new Error('업무표 원본은 체크리스트에서 변경할 수 없습니다.');
  return { kind: 'ITEM', id: item?.id || crypto.randomUUID(), projectId: Number(draft.projectId), rowVersion: item?.row_version ?? null, mutationId: crypto.randomUUID(), body: { date: draft.date, title: draft.title.trim(), completed: draft.completed, ...(draft.direction ? { direction: draft.direction } : {}) } };
}
export function boardSegments(text = '') {
  return String(text).split(/(https?:\/\/[^\s<>]+)/gi).filter(Boolean).map(value => {
    try { const url = new URL(value); return { text: value, href: /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : null }; }
    catch { return { text: value, href: null }; }
  });
}
