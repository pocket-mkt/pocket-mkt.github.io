import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { meetingSearchTerms, meetingSearchFilter, meetingMatches, highlightMeetingText } from '../src/meetingSearch.js';
import { searchMeetings } from '../src/supabase/meetingSearchApi.js';

test('all keywords use literal substring search without special cases or synonyms', () => {
  assert.deepEqual(meetingSearchTerms(' seo '), ['seo']);
  assert.deepEqual(meetingSearchTerms('상위노출'), ['상위노출']);
  assert.deepEqual(meetingSearchTerms('촬영 일정'), ['촬영 일정']);
  assert.deepEqual(meetingSearchTerms('예약'), ['예약']);
  assert.deepEqual(meetingSearchTerms('   '), []);
  assert.equal(meetingSearchTerms('a'.repeat(100))[0].length, 80);
});
test('snippets find old meeting decisions and actions, with literal safe highlights', () => {
  const matches = meetingMatches({ decisions_text: '상위노출을 진행', action_items_text: 'NS: SEO 점검' }, meetingSearchTerms('SEO'));
  assert.deepEqual(matches.map(m => m.label), ['후속업무']);
  assert.deepEqual(meetingMatches({ discussion_text: '다음 촬영 일정은 수요일입니다.' }, ['촬영 일정']).map(m=>m.label), ['회의내용']);
  assert.equal(meetingMatches({ decisions_text: 'SEO' }, ['SEO'], 'title').length,0);
  assert.deepEqual(highlightMeetingText('<script> SEO [a]', ['SEO','[a]']).filter(p=>p.match).map(p=>p.text),['SEO','[a]']);
  assert.ok(meetingSearchFilter(['a%,b"']).includes('\\\\%'));
  assert.ok(meetingSearchFilter(['a%,b"']).includes('\\"'));
});
function fixture(rows = [], status=200) {
  const requests=[];
  const client=createClient('https://example.supabase.co','public-test-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(url,options)=>{
    requests.push({url:new URL(url),options});
    return new Response(JSON.stringify(status===200?rows:{code:'42501',message:'private detail'}),{status,headers:{'Content-Type':'application/json'}});
  }}});
  return {client,requests};
}
test('server search covers all dates, applies project/archive filters before bounded pagination', async () => {
  const {client,requests}=fixture(Array.from({length:21},(_,id)=>({id,meeting_date:'2020-01-01'})));
  const result=await searchMeetings(client,{query:'SEO',projectIds:['1','2','1'],page:1});
  assert.equal(result.data.items.length,20);assert.equal(result.data.hasMore,true);
  const query=requests[0].url.searchParams;
  assert.equal(query.get('archived_at'),'is.null');assert.equal(query.get('project_id'),'in.(1,2)');
  assert.equal(query.get('offset'),'20');assert.equal(query.get('limit'),'21');
  assert.equal(query.get('order'),'meeting_date.desc,id.desc');assert.equal(query.has('meeting_date'),false);
  assert.ok(query.get('or').includes('action_items_text.ilike'));assert.ok(!query.get('or').includes('상위노출'));
  assert.ok(!query.get('select').includes('created_by_user_id'));
});
test('empty queries/scopes do not read, misc and fields narrow on server, errors are not empty success', async () => {
  const {client,requests}=fixture();
  await searchMeetings(client,{query:'',projectIds:['1']});await searchMeetings(client,{query:'SEO'});assert.equal(requests.length,0);
  await searchMeetings(client,{query:'SEO',related:false,field:'decisions_text',projectIds:['3'],misc:true});
  assert.equal(requests[0].url.searchParams.get('title'),'like.[기타]%');
  assert.equal(requests[0].url.searchParams.get('or'),'(decisions_text.ilike."%SEO%")');
  await assert.rejects(searchMeetings(client,{query:'*',projectIds:['1']}),{code:'invalid_search'});
  await assert.rejects(searchMeetings(client,{query:'SEO',projectIds:['1),2']}),{code:'invalid_id'});
  await assert.rejects(searchMeetings(fixture([],403).client,{query:'SEO',projectIds:['1']}),{code:'forbidden'});
});
