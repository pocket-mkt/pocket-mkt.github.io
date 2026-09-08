import test from 'node:test';
import assert from 'node:assert/strict';
import {createClientProgressReader} from '../src/supabase/taskRead.js';
import {parseViewLocation, viewLocationHash, viewResourceKey} from '../src/planNavigation.js';
import {tasksViewModel} from '../src/api/viewModel.js';

const payload = () => ({audience:'client-progress',project:{project_id:1},items:[{task_id:1,project_id:1,title:'공개 업무',visibility_code:'CLIENT',status_code:'ON_HOLD',status_mode:'MANUAL',progress_percent:40}],totalMatching:1});
test('customer progress has a separate route and cache',()=>{
  assert.equal(parseViewLocation('#tasks/client-progress').view,'client-progress');
  assert.equal(viewLocationHash('client-progress'),'tasks/client-progress');
  assert.equal(viewResourceKey('client-progress'),'client-progress');
  assert.notEqual(viewResourceKey('client-progress'),viewResourceKey('progress'));
});
test('safe reader uses one dedicated RPC, forwards abort and yields no issue permissions',async()=>{
  const controller=new AbortController(); let called=0;
  const reader=createClientProgressReader({rpc(name,args){
    called++; assert.equal(name,'read_client_progress'); assert.deepEqual(args,{p_project_id:'1'});
    return {abortSignal(signal){assert.equal(signal,controller.signal);return Promise.resolve({data:payload(),error:null});}};
  }});
  const page=tasksViewModel(await reader({projectId:'1',signal:controller.signal}));
  assert.equal(called,1); assert.equal(page.items[0].title,'공개 업무');
  assert.deepEqual(page.issues,[]); assert.deepEqual(page.members,[]); assert.equal(page.issueCanWrite,false);
});
test('safe reader fails closed on hidden/cross-project/private data and legacy envelopes',async()=>{
  for(const mutate of [
    p=>{p.items[0].visibility_code='PROJECT_TEAM';},
    p=>{p.items[0].project_id=2;},p=>{p.items[0].remarks='private';},
    p=>{p.items[0].responsible_org_code='NS';},
    p=>{p.issues=[];},p=>{p.meetings=[];},p=>{delete p.audience;},
  ]) {
    const data=payload(); mutate(data);
    const reader=createClientProgressReader({rpc:async()=>({data})});
    await assert.rejects(reader({projectId:1}),error=>error.code==='invalid_contract');
  }
});
test('RPC failure never falls back to a task workspace or Sheets',async()=>{
  let called=0;
  const reader=createClientProgressReader({rpc:async name=>{
    called++; assert.equal(name,'read_client_progress'); return {error:{code:'42501',message:'forbidden_project'}};
  }});
  await assert.rejects(reader({projectId:1})); assert.equal(called,1);
});
