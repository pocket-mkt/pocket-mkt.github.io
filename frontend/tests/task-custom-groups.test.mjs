import test from 'node:test';
import assert from 'node:assert/strict';
import { customTaskRows, groupTaskUpdates } from '../src/taskCustomGroups.js';
const tasks=[{id:1,taskGroupId:'g',taskGroupName:'유입',scheduleDates:['2026-09-01','2026-09-03'],statusCode:'DONE'}, {id:2}, {id:3,taskGroupId:'g',taskGroupName:'유입',scheduleDates:['2026-09-05']}];
test('custom groups retain members, preserve sparse dates, and expand locally',()=>{
 const rows=customTaskRows(tasks);assert.equal(rows.length,2);assert.equal(rows[0].customGroup.done,1);
 assert.deepEqual([...rows[0].customGroup.dates],['2026-09-01','2026-09-03','2026-09-05']);
 assert.deepEqual(customTaskRows(tasks,new Set(['g'])).filter(r=>r.task).map(r=>r.id),[1,3,2]);
 assert.equal(tasks.length,3);
});
test('group/ungroup updates only membership, never status, visibility or schedule',()=>{
 assert.deepEqual(groupTaskUpdates([tasks[0]],' 이름 ','new')[0].fields,{task_group_id:'new',task_group_name:'이름'});
 assert.deepEqual(groupTaskUpdates([tasks[0]],'',null)[0].fields,{task_group_id:null,task_group_name:null});
 assert.throws(()=>groupTaskUpdates(tasks,' ','g'));assert.throws(()=>groupTaskUpdates(Array(41).fill(tasks[0]),'g','g'));
});
