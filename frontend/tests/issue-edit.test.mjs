import test from 'node:test';
import assert from 'node:assert/strict';
import { issueEditInitial, issueEditFields } from '../src/issueRequestEdit.js';
const issue={id:'7',relatedTask:'원고',body:'확인 요청',kind:'기존 유형',owner:'허준',requester:'NS',dueDate:'2026-09-01',completionUrl:'https://example.com/',statusCode:'DONE',remarks:'기존 답변',createdAt:'2026-08-01',rowVersion:3};
test('editing request patches only changed fields, preserving identity, author dates, status and replies',()=>{
 const fields=issueEditFields(issue,{...issueEditInitial(issue),title:'새 제목',body:'새 내용',deadline:'2026-09-10'});
 assert.deepEqual(fields,{related_task_text:'새 제목',body_text:'새 내용',due_date:'2026-09-10'});
 assert.equal(issue.statusCode,'DONE');assert.equal(issue.remarks,'기존 답변');
});
test('unchanged edit makes no mutation; optional link and deadline can be cleared',()=>{
 assert.deepEqual(issueEditFields(issue,issueEditInitial(issue)),{});
 assert.deepEqual(issueEditFields(issue,{...issueEditInitial(issue),link:'',deadline:''}),{completion_url:'',due_date:null});
});
test('required values and unsafe links rejected; old deadlines remain editable',()=>{
 assert.throws(()=>issueEditFields(issue,{...issueEditInitial(issue),body:' '}));
 assert.throws(()=>issueEditFields(issue,{...issueEditInitial(issue),link:'javascript:alert(1)'}));
 assert.deepEqual(issueEditFields(issue,{...issueEditInitial(issue),owner:'포켓컴퍼니'}),{owner_text:'포켓컴퍼니'});
});
