import { briefRequestFields } from './progressBrief.js';

export const ISSUE_REQUEST_TYPES = ['콘텐츠 검토', '자료 요청', '내용 확인', '일정 확인', '추가 요청'];
export function issueEditInitial(issue) {
  return {title:issue.relatedTask || '',body:issue.body || '',kind:issue.kind || '',owner:issue.owner || '',requester:issue.requester || '',link:issue.completionUrl || '',deadline:issue.dueDate || ''};
}
export function issueEditFields(issue, draft) {
  const {status_code, ...fields} = briefRequestFields(draft);
  const original = {related_task_text:issue.relatedTask,body_text:issue.body,kind_text:issue.kind,owner_text:issue.owner,requester_text:issue.requester,completion_url:issue.completionUrl,due_date:issue.dueDate};
  return Object.fromEntries(Object.entries(fields).filter(([key,value]) => (value || '') !== (original[key] || '')));
}
