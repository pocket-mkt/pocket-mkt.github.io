export const SEARCH_FIELDS = { title: '제목', discussion_text: '회의내용', decisions_text: '결정사항', action_items_text: '후속업무' };
export function meetingSearchTerms(query) {
  const text = String(query || '').trim().slice(0, 80);
  if (!text) return [];
  return [text];
}
// Quote PostgREST values separately from LIKE escaping; punctuation is never filter syntax.
export function meetingSearchFilter(terms, field = 'all') {
  const fields = field in SEARCH_FIELDS ? [field] : Object.keys(SEARCH_FIELDS);
  return fields.flatMap(key => terms.map(term => {
    const pattern = '%' + term.replace(/[\\%_*]/g, '\\$&') + '%';
    return `${key}.ilike."${pattern.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  })).join(',');
}
export function meetingMatches(row, terms, field = 'all') {
  return Object.entries(SEARCH_FIELDS).filter(([key]) => field === 'all' || field === key).flatMap(([key, label]) => {
    const text = String(row[key] || '');
    const indexes = terms.map(term => text.toLowerCase().indexOf(term.toLowerCase())).filter(index => index >= 0);
    if (!indexes.length) return [];
    const at = Math.min(...indexes), start = Math.max(0, at - 55), end = Math.min(text.length, at + 160);
    return [{ key, label, text: (start ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '') }];
  });
}
export function highlightMeetingText(text, terms) {
  if (!terms.length) return [{ text, match: false }];
  const escaped = [...terms].sort((a,b) => b.length-a.length).map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
  return String(text).split(regex).map((part, index) => ({ text: part, match: index % 2 === 1 }));
}
