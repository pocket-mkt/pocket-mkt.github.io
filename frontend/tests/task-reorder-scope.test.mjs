import test from 'node:test';
import assert from 'node:assert/strict';
import { scopedTaskSortOrders } from '../src/taskReorderScope.js';
import { accessAdminViewModel } from '../src/api/viewModel.js';
test('월별 드래그는 선택된 업무의 순서 슬롯만 교환한다',()=>{
  const all=[{id:'old',sortOrder:10},{id:'a',sortOrder:20},{id:'old2',sortOrder:30},{id:'b',sortOrder:40}];
  const before=JSON.stringify(all);
  assert.deepEqual(scopedTaskSortOrders([all[3],all[1]],all),[20,40]);
  assert.equal(JSON.stringify(all),before);
});
test('중복 순서가 있는 월은 다른 월을 수정하지 않는 별도 위치를 사용한다',()=>{
  assert.deepEqual(scopedTaskSortOrders([{sortOrder:0},{sortOrder:0}],[{sortOrder:60}]),[70,80]);
});
test('권한관리 프로젝트·계정 목록은 고객사명과 프로젝트명을 보존한다',()=>{
  const result=accessAdminViewModel({data:{clients:[{client_id:'C',display_name:'QA 고객사'}],projects:[{project_id:5,client_id:'C',project_name:'온라인 캠페인'}],accounts:[{user_id:'user',accesses:[{project_id:5,membership_id:7,client_id:'C',allowed_pages:['reports']}]}]}});
  assert.equal(result.projects[0].clientName,'QA 고객사');assert.equal(result.projects[0].id,'5');
  assert.equal(result.accounts[0].accesses[0].clientName,'QA 고객사');
});
