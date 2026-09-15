import { HubApiError } from '../api/errors.js';
import { meetingSearchFilter, meetingSearchTerms } from '../meetingSearch.js';

export async function searchMeetings(client, { query, related = true, field = 'all', projectIds = [], misc = false, page = 0, signal } = {}) {
  const terms = meetingSearchTerms(query, related);
  const ids = [...new Set(projectIds.map(String))];
  if (!terms.length || !ids.length) return { ok: true, data: { items: [], hasMore: false } };
  if (terms.some(term => term.includes('*'))) throw new HubApiError('별표(*)를 제외하고 검색어를 입력해 주세요.', { code: 'invalid_search' });
  if (ids.some(id => !/^[1-9]\d*$/.test(id))) throw new HubApiError('프로젝트를 다시 선택해 주세요.', { code: 'invalid_id' });
  const offset = Math.max(0, Math.trunc(Number(page) || 0)) * 20;
  // Existing daily_meetings RLS enforces active account, project, page and row visibility.
  let request = client.from('daily_meetings')
    .select('id,project_id,meeting_date,title,discussion_text,decisions_text,action_items_text,created_at,updated_at')
    .is('archived_at', null).in('project_id', ids)
    .or(meetingSearchFilter(terms, field));
  if (misc) request = request.like('title', '[기타]%');
  request = request.order('meeting_date', { ascending: false }).order('id', { ascending: false })
    .range(offset, offset + 20);
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw new HubApiError('회의록 검색에 실패했습니다. 잠시 후 다시 시도해 주세요.', { code: error.code === '42501' ? 'forbidden' : 'meeting_search_failed' });
  if (!Array.isArray(data)) throw new HubApiError('검색 응답을 확인할 수 없습니다.', { code: 'invalid_contract' });
  return { ok: true, data: { items: data.slice(0,20), hasMore: data.length > 20 } };
}
