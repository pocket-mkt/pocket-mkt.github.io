export function checklistToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function checklistProjectRoute(project) { return String(project.navigation_id || project.id); }
export function checklistDeadline(item, today = checklistToday()) {
  if (item.completed_at) return null;
  if (item.task_date < today) return { kind: 'overdue', label: '기한 지남' };
  if (item.task_date === today) return { kind: 'today', label: '오늘 마감' };
  return null;
}
export function checklistBucket(item, now = Date.now()) {
  return item.completed_at && new Date(item.completed_at).getTime() <= now - 7 * 86400000 ? 'completed' : 'active';
}
export function checklistDraft(item, projectId) {
  return { date: item?.task_date || checklistToday(), title: item?.title || '', projectId: String(item?.project_id || projectId || ''), completed: Boolean(item?.completed_at) };
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
