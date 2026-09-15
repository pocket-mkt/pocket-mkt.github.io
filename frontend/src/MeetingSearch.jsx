import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { SEARCH_FIELDS, highlightMeetingText, meetingMatches, meetingSearchTerms } from './meetingSearch.js';
import './meetingSearch.css';

function Highlight({ text, terms }) {
  return highlightMeetingText(text, terms).map((part, i) => part.match ? <mark key={i}>{part.text}</mark> : part.text);
}
export default function MeetingSearch({ projects, onSearch, renderMeeting, revision }) {
  const [query, setQuery] = useState('');
  const [project, setProject] = useState('all'), [field, setField] = useState('all'), [page, setPage] = useState(0);
  const [state, setState] = useState({ key: '', items: [], hasMore: false, loading: false, error: '' });
  const [retry, setRetry] = useState(0), [opened, setOpened] = useState(null);
  const searchRef = useRef(onSearch); searchRef.current = onSearch;
  const terms = meetingSearchTerms(query), active = terms.length > 0;
  const scope = JSON.stringify(projects.map(p => ({ id: String(p.id), saveProjectId: String(p.saveProjectId || p.id), isMisc: !!p.isMisc })));
  const key = JSON.stringify([query.trim(), project, field, page, scope, revision, retry]);
  useEffect(() => {
    const controller = new AbortController(); let stopped = false;
    setOpened(null);
    if (!active) { setState({ key, items: [], hasMore: false, loading: false, error: '' }); return; }
    setState({ key, items: [], hasMore: false, loading: true, error: '' });
    const timer = setTimeout(async () => {
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const choices = JSON.parse(scope), selected = choices.find(p => p.id === project);
        const ids = project === 'all' ? choices.map(p => p.saveProjectId) : selected ? [selected.saveProjectId] : [];
        const response = await searchRef.current({ query, field, projectIds: ids, misc: !!selected?.isMisc, page, signal: controller.signal });
        if (controller.signal.aborted) throw new Error('search_aborted');
        if (!stopped) setState({ key, items: response.data.items, hasMore: response.data.hasMore, loading: false, error: '' });
      } catch (error) {
        if (!stopped) setState({ key, items: [], hasMore: false, loading: false, error: controller.signal.aborted ? '검색 시간이 초과됐습니다. 다시 시도해 주세요.' : error?.code === 'invalid_search' ? '별표(*)를 제외하고 검색어를 입력해 주세요.' : '검색하지 못했습니다. 권한과 연결 상태를 확인한 뒤 다시 시도해 주세요.' });
      } finally { clearTimeout(timeout); }
    }, 300);
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, [key]); // key includes all request inputs; changing query invalidates old responses immediately.
  const update = (setter) => (event) => { setter(event.target.value); setPage(0); setOpened(null); };
  const current = state.key === key;
  const items = current ? state.items : [], loading = active && (!current || state.loading);
  const company = row => String(row.title || '').startsWith('[기타]') ? '기타' : projects.find(p => String(p.id) === String(row.project_id))?.clientName || '업체';
  const asMeeting = row => ({ id: String(row.id), projectId: String(row.project_id), date: row.meeting_date, title: row.title, discussion: row.discussion_text, decisions: row.decisions_text, actionItems: row.action_items_text, clientName: company(row) });
  return <section className="meeting-search" aria-label="전체 기간 회의록 검색">
    <div className="meeting-search-controls">
      <label className="meeting-search-input"><Search size={18}/><span className="meeting-search-sr">회의록 검색</span><input type="search" maxLength={80} placeholder="찾고 싶은 키워드를 입력하세요" value={query} onChange={update(setQuery)}/>{query && <button type="button" aria-label="검색어 지우기" onClick={() => { setQuery(''); setPage(0); }}><X size={16}/></button>}</label>
      <select aria-label="검색 업체" value={project} onChange={update(setProject)}><option value="all">전체 업체</option>{projects.map(p => <option key={p.id} value={p.id}>{p.clientName}</option>)}</select>
      <select aria-label="검색 항목" value={field} onChange={update(setField)}><option value="all">전체 내용</option>{Object.entries(SEARCH_FIELDS).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select>
    </div>
    <p className="meeting-search-hint">전체 기간 · 최신순 · 입력한 키워드가 포함된 회의록 검색</p>
    {active && <div className="meeting-search-results" aria-busy={loading}>
      <p role="status">{loading ? '전체 기간에서 찾는 중…' : current && state.error ? '' : items.length ? `${page + 1}페이지 · ${items.length}건${state.hasMore ? ' · 다음 결과 있음' : ''}` : '일치하는 회의록이 없습니다.'}</p>
      {current && state.error && <p role="alert">{state.error} <button type="button" onClick={() => setRetry(value => value + 1)}>다시 시도</button></p>}
      {items.map(row => <article className="meeting-search-result" key={row.id}>
        <button type="button" className="meeting-search-hit" aria-expanded={opened === row.id} onClick={() => setOpened(opened === row.id ? null : row.id)}>
          <span className="meeting-search-meta"><b>{company(row)}</b><time>{row.meeting_date}</time><strong><Highlight text={String(row.title || '').replace(/^\[기타\]\s*/, '')} terms={terms}/></strong></span>
          <span className="meeting-search-excerpts">{meetingMatches(row, terms, field).map(match => <span key={match.key}><small>{match.label}</small><span><Highlight text={match.text} terms={terms}/></span></span>)}</span>
          <span className="meeting-search-open">{opened === row.id ? '접기 −' : '원문 펼치기 +'}</span>
        </button>
        {opened === row.id && <div className="meeting-search-original">{renderMeeting(asMeeting(row))}</div>}
      </article>)}
      {!loading && current && !state.error && (page > 0 || state.hasMore) && <nav aria-label="검색 결과 페이지"><button type="button" disabled={!page} onClick={() => setPage(page - 1)}>이전</button><span>{page + 1}페이지</span><button type="button" disabled={!state.hasMore} onClick={() => setPage(page + 1)}>다음</button></nav>}
    </div>}
  </section>;
}
