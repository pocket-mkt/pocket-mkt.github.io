import test from 'node:test';
import assert from 'node:assert/strict';
import {canOperateProject,operatorVisibilityOptions} from '../src/operatorCapabilities.js';
import {taskUpdateSubmissionFields} from '../src/taskForm.js';
import {createSupabaseCoreDomainApi} from '../src/supabase/coreDomainApi.js';
test('NS와 포켓의 일반 운영 권한은 동일하고 전용 데이터는 분리한다',()=>{
  for(const role of ['pocket','ns']){assert.equal(canOperateProject(role,true),true);assert.equal(canOperateProject(role,false),false);assert.deepEqual(operatorVisibilityOptions(role).slice(0,2).map(x=>x[0]),['PROJECT_TEAM','CLIENT']);}
  for(const role of ['client','unknown',undefined]){assert.equal(canOperateProject(role,true),false);assert.deepEqual(operatorVisibilityOptions(role),[]);}
  assert(!operatorVisibilityOptions('ns').some(x=>x[0]==='POCKET_ONLY'));assert(operatorVisibilityOptions('pocket').some(x=>x[0]==='POCKET_ONLY'));
});
test('업무 편집은 명시적인 공개 범위만 함께 저장한다',()=>{
  assert.equal(taskUpdateSubmissionFields({visibility_code:'PROJECT_TEAM'}).visibility_code,'PROJECT_TEAM');
  assert(!('visibility_code' in taskUpdateSubmissionFields({})));
});
test('프로젝트 착수일은 행 버전과 저장 ID를 유지하며 범용 프로젝트 변경을 거절한다',async()=>{
  const calls=[];const api=createSupabaseCoreDomainApi({rpc:async(name,args)=>{calls.push({name,args});return {data:{ok:true,data:{item:{start_date:args.p_start_date}}},error:null};}});
  await api.mutateProjectStart({projectId:5,mutationId:'qa-project-date',mutation:{operation:'UPDATE',expectedRowVersion:4,fields:{start_date:'2026-10-01'}}});
  assert.equal(calls[0].name,'update_project_start_date');assert.equal(calls[0].args.p_expected_row_version,'4');assert.equal(calls[0].args.p_mutation_id,'qa-project-date');
  assert.throws(()=>api.mutateProjectStart({projectId:5,mutation:{operation:'UPDATE',expectedRowVersion:4,fields:{start_date:'2026-10-01',client_view_enabled:true}}}),/착수일만/);
});
