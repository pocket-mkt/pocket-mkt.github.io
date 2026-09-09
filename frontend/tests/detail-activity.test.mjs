import test from 'node:test';
import assert from 'node:assert/strict';
import { createDetailActivityReader, readDetailTaskEvent, readIssueActivityContext } from '../src/supabase/detailActivityRead.js';

test('계정 생성 활동과 확인요청 유형 필터를 함께 서버 적용한다',async()=>{
 const f=fixture();const actorId='12345678-1234-1234-1234-123456789abc';
 await f.read({actorId,actionCode:'CREATED',entityFilter:'PROJECT_ISSUE'});
 for(const [field,value] of [['actor_user_id',actorId],['action_code','CREATED'],['entity_type','PROJECT_ISSUE']])assert.ok(f.calls.some(c=>c[1]==='eq'&&c[2]===field&&c[3]===value));
 await assert.rejects(f.read({actionCode:'anything'}),{code:'invalid_filter'});
});

test('확인요청 내용은 기존 권한 RPC에서 선택한 항목만 반환하며 다른 데이터는 버린다',async()=>{
 const event={entity_type:'PROJECT_ISSUE',entity_id:5,project_id:7};let args;
 const client={rpc(name,params){args={name,params};return Promise.resolve({data:{items:[{title:'irrelevant task'}],issues:[{issue_id:5,related_task_text:'원고',body_text:'검토 요청',kind_text:'컨펌'},{issue_id:6,body_text:'다른 요청'}]}});}};
 const result=await readIssueActivityContext(client,event);
 assert.equal(args.name,'read_task_workspace');assert.equal(args.params.p_project_id,'7');
 assert.deepEqual(result.data,{relatedTask:'원고',body:'검토 요청',kind:'컨펌'});
 await assert.rejects(readIssueActivityContext(client,{...event,entity_id:88}),{code:'detail_log_unavailable'});
 await assert.rejects(readIssueActivityContext(client,{...event,entity_type:'PROJECT_CREDENTIAL'}),{code:'invalid_filter'});
});

test('통합 알림은 최근 24시간 새 업무와 확인요청 생성 기록만 서버 조회한다',async()=>{
 const f=fixture();await f.read({workspaceNotifications:true});
 assert.ok(f.calls.some(c=>c[1]==='in'&&c[2]==='entity_type'&&JSON.stringify(c[3])==='["TASK","PROJECT_ISSUE"]'));
 for(const [field,value] of [['action_code','CREATED'],['event_status_code','COMMIT']])assert.ok(f.calls.some(c=>c[1]==='eq'&&c[2]===field&&c[3]===value));
 assert.ok(f.calls.some(c=>c[1]==='gte'&&c[2]==='created_at'));
 assert.equal(f.calls.some(c=>c[1]==='eq'&&c[2]==='project_id'),false);
});

test('프로젝트·한국시간 기간 필터는 서버에 적용되며 잘못된 기간을 거부한다',async()=>{
 const f=fixture();await f.read({projectId:'7',fromDate:'2026-09-08',toDate:'2026-09-08'});
 assert.ok(f.calls.some(c=>c[1]==='gte'&&c[3]==='2026-09-07T15:00:00.000Z'));
 assert.ok(f.calls.some(c=>c[1]==='lt'&&c[3]==='2026-09-08T15:00:00.000Z'));
 assert.ok(f.calls.some(c=>c[1]==='eq'&&c[2]==='project_id'&&c[3]==='7'));
 await assert.rejects(f.read({fromDate:'2026-09-09',toDate:'2026-09-08'}),{code:'invalid_filter'});
});

test('업무 상세는 허용 RPC로 프로젝트별 묶음 조회하고 event_id로만 연결한다',async()=>{
 const events=[{id:8,event_id:'e8',project_id:7,entity_id:1,entity_type:'TASK',event_status_code:'COMMIT',created_at:'2026-09-08T00:00:00.123456Z'}, {id:7,event_id:'e7',project_id:7,entity_type:'TASK',event_status_code:'COMMIT',created_at:'2026-09-08T00:00:00Z'}, {id:6,event_id:'secret',project_id:7,entity_type:'PROJECT_CREDENTIAL',event_status_code:'COMMIT'}];
 const rpcCalls=[];
 const client={from(table){const q={then:resolve=>Promise.resolve({data:table==='activity_events'?events:[]}).then(resolve)};for(const method of ['select','order','limit'])q[method]=()=>q;return q;},rpc(name,args){rpcCalls.push({name,args});return Promise.resolve({data:{items:[{event_id:'e8',task_title:'블로그',changes:[{field:'progress_percent',before:30,after:60}]}]}});}};
 const result=await createDetailActivityReader(client)();
 assert.equal(rpcCalls.filter(call=>call.name==='read_task_activity').length,1);assert.equal(rpcCalls[0].args.p_before_id,'9');assert.equal(rpcCalls[0].args.p_before_created_at,events[0].created_at);
 assert.equal(result.data.items[0].task_detail.task_title,'블로그');assert.equal(result.data.items[1].task_detail,null);assert.equal(result.data.items[2].task_detail,undefined);
 const single=await readDetailTaskEvent(client,events[0]);assert.equal(single.data.event_id,'e8');assert.equal(rpcCalls.at(-1).args.p_limit,1);
 await assert.rejects(readDetailTaskEvent(client,events[2]),{code:'invalid_filter'});
 await assert.rejects(readDetailTaskEvent(client,events[1]),{code:'detail_log_unavailable'});
 client.rpc=()=>Promise.resolve({error:{code:'42501'}});
 const denied=await createDetailActivityReader(client)();assert.equal(denied.data.items[0].detail_unavailable,true);
});
function fixture(error=null) {
 const calls=[];
 const client={from(table){const q={then(resolve){return Promise.resolve({data:table!=='activity_events'?[]:[{id:2,created_at:'2026-09-08T00:00:00Z'},{id:1,created_at:'2026-09-07T00:00:00Z'}],error}).then(resolve);}};for(const key of ['select','order','limit','eq','in','is','or','gte','lt','abortSignal'])q[key]=(...args)=>{calls.push([table,key,...args]);return q;};return q;}};
 return {read:createDetailActivityReader(client),calls};
}
test('세부로그는 안전한 허용 컬럼만 조회하고 계정별 필터와 서버 페이지 경계를 적용한다',async()=>{
 const f=fixture();const actorId='12345678-1234-1234-1234-123456789abc';
 const result=await f.read({actorId,limit:1});
 assert.equal(result.data.items.length,1);assert.equal(result.data.nextCursor.id,'2');
 assert.ok(f.calls.some(c=>c[1]==='eq'&&c[2]==='actor_user_id'&&c[3]===actorId));
 assert.doesNotMatch(f.calls.filter(c=>c[1]==='select').map(c=>c[2]).join(','),/\*|before_data|after_data|email|password/);
 await assert.rejects(f.read({actorId:'bad'}),{code:'invalid_filter'});
 await assert.rejects(f.read({cursor:{id:'1),x',createdAt:'2026-09-08'}}),{code:'invalid_cursor'});
});
test('권한 오류는 빈 목록으로 위장하거나 Sheets로 우회하지 않는다',async()=>{
 await assert.rejects(fixture({code:'42501'}).read(),{code:'forbidden'});
 const f=fixture();await f.read({actorId:'system'});assert.ok(f.calls.some(c=>c[1]==='is'&&c[2]==='actor_user_id'));
});
