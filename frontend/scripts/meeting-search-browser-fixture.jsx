import React from 'react';
import MeetingSearch from '../src/MeetingSearch.jsx';
export async function runMeetingSearchQa(render, tick, check) {
  const projects=[{id:'1',clientName:'UND'},{id:'3',clientName:'포켓컴퍼니'},{id:'misc',saveProjectId:'3',isMisc:true,clientName:'기타'}];
  const row={id:1,project_id:1,meeting_date:'2020-01-03',title:'이전 SEO 회의',discussion_text:'이전 회의의 검색 최적화 관련 내용을 확인합니다.',decisions_text:'상위노출 점검을 진행하기로 결정했습니다.',action_items_text:'NS: SEO 결과를 공유합니다.'};
  let fail=false, requests=[], oldResolve;
  const search=async args=>{requests.push(args);if(args.query==='대기')return new Promise(resolve=>oldResolve=resolve);if(fail)throw Error('qa');return {data:{items:[{...row,id:args.page+1}],hasMore:args.page===0}};};
  const fixture=<MeetingSearch projects={projects} onSearch={search} renderMeeting={meeting=><div data-qa-original>{meeting.date} · {meeting.discussion} · {meeting.decisions} · {meeting.actionItems}</div>}/>;
  await render(<div/>);await render(fixture);
  const type=async value=>{const input=document.querySelector('.meeting-search input[type=search]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));await tick();};
  const wait=async()=>{for(let i=0;i<35;i++){await tick();if(document.querySelector('.meeting-search-hit')||document.querySelector('.meeting-search [role=alert]'))return;}};
  await type('S');await type('SE');await type('SEO');await wait();
  check(requests.length===1,'search not debounced');check(document.querySelector('mark')?.textContent==='SEO','highlight missing');
  check(document.querySelector('.meeting-search-meta').textContent.includes('2020-01-03'),'old date lost');
  document.querySelector('.meeting-search-hit').click();await tick();check(document.querySelector('[data-qa-original]').textContent.includes('NS: SEO'),'full original not shown');
  document.querySelector('.meeting-search-results nav button:last-child').click();await wait();check(requests.at(-1).page===1,'next page not fetched');
  const company=document.querySelector('[aria-label="검색 업체"]');company.value='misc';company.dispatchEvent(new Event('change',{bubbles:true}));await wait();
  check(requests.at(-1).misc&&requests.at(-1).projectIds.join()==='3'&&requests.at(-1).page===0,'misc scope/page reset');
  const field=document.querySelector('[aria-label="검색 항목"]');field.value='decisions_text';field.dispatchEvent(new Event('change',{bubbles:true}));await wait();check(requests.at(-1).field==='decisions_text','field filter');
  await type('대기');for(let i=0;i<12&&!oldResolve;i++)await tick();await type('SEO');await wait();
  oldResolve({data:{items:[{...row,title:'오래된 응답'}],hasMore:false}});await tick();check(!document.querySelector('.meeting-search').textContent.includes('오래된 응답'),'stale response replaced results');
  fail=true;await type('오류');await wait();check(document.querySelector('.meeting-search [role=alert]'),'failure shown as empty success');
  fail=false;document.querySelector('.meeting-search [role=alert] button').click();await wait();check(document.querySelector('.meeting-search-hit'),'retry failed');
  document.querySelector('[aria-label="검색어 지우기"]').click();await tick();check(!document.querySelector('.meeting-search-results'),'clear leaves stale data');
  await type('SEO');await wait();
  check(document.documentElement.scrollWidth<=window.innerWidth+1,'search causes horizontal page overflow');
  const hit=document.querySelector('.meeting-search-hit');check(hit.scrollWidth<=hit.clientWidth+1,'result content overflow');
  return ['automatic debounced all-date search, highlights, original, pagination, misc/field filters, race, error/retry, clear, responsive'];
}
