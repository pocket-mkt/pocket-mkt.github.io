import test from 'node:test';
import assert from 'node:assert/strict';
import {createDetailActivityReader} from '../src/supabase/detailActivityRead.js';

const events=[{id:9,event_id:'event-9',entity_id:1,project_id:7,entity_type:'TASK',event_status_code:'COMMIT',created_at:'2026-09-09T01:00:00Z'},{id:8,event_id:'event-8',entity_id:2,project_id:7,entity_type:'TASK',event_status_code:'COMMIT',created_at:'2026-09-09T00:00:00Z'},{id:7,event_id:'event-7',entity_id:3,project_id:7,entity_type:'PROJECT_ISSUE',event_status_code:'COMMIT',created_at:'2026-09-08T00:00:00Z'}];
function clientFor(rpc){return {rpc,from(table){const q={then:resolve=>Promise.resolve({data:table==='activity_events'?structuredClone(events):[]}).then(resolve)};for(const method of ['select','order','limit'])q[method]=()=>q;return q;}};}
test('all displayed task details and issue content load without per-row actions',async()=>{
 const calls=[];
 const client=clientFor(async(name,args)=>{
  calls.push({name,args});
  if(name==='read_task_workspace')return {data:{items:[],issues:[{issue_id:3,related_task_text:'시안',body_text:'검토 요청'}]}};
  if(args.p_before_id==='10')return {data:{items:[{event_id:'event-9',task_title:'첫 업무'}],nextCursor:{createdAt:events[1].created_at,id:9}}};
  return {data:{items:[{event_id:'event-8',task_title:'이전 업무'}],nextCursor:null}};
 });
 const result=await createDetailActivityReader(client)();
 assert.equal(result.data.items[0].task_detail.task_title,'첫 업무');assert.equal(result.data.items[1].task_detail.task_title,'이전 업무');
 assert.equal(result.data.items[2].issue_context.body,'검토 요청');assert.equal(calls.filter(c=>c.name==='read_task_workspace').length,1);
});
test('legacy RPC fallback preserves exact event matching and never fabricates changes',async()=>{
 const client=clientFor(async(name,args)=>{
  if(name==='read_task_workspace')return {data:{items:[{task_id:2,title:'현재 이름'}],issues:[]}};
  if('p_before_id' in args)return {error:{code:'PGRST202'}};
  return {data:{items:[{event_id:'event-9',task_title:'과거 이름',changes:[]}]}};
 });
 const result=await createDetailActivityReader(client)();
 assert.equal(result.data.items[0].task_detail.task_title,'과거 이름');assert.equal(result.data.items[1].task_detail,null);
 assert.equal(result.data.items[1].task_current_title,'현재 이름');assert.equal(result.data.items[1].detail_error_code,'detail_not_found');
});
test('permission failures remain visible and do not trigger privilege fallback',async()=>{
 let reads=0;const client=clientFor(async name=>{
  if(name==='read_task_activity'){reads++;return {error:{code:'42501'}};}
  return {data:{items:[],issues:[]}};
 });
 const result=await createDetailActivityReader(client)();assert.equal(reads,1);assert.equal(result.data.items[0].detail_error_code,'42501');
});
