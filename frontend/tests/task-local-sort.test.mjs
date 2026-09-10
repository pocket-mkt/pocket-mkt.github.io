import test from 'node:test';
import assert from 'node:assert/strict';
import { cycleTaskLocalSort, sortTasksLocally } from '../src/taskLocalSort.js';

test('local cycles, latest priority, stable ties and immutable source', () => {
  const tasks = [{id:1,statusCode:'IN_PROGRESS',responsibleOrgCode:'POCKET'}, {id:2,statusCode:'DONE',responsibleOrgCode:'POCKET'}, {id:3,statusCode:'DONE',responsibleOrgCode:'NS'}, {id:4,statusCode:'DELAYED',responsibleOrgCode:'NS'}];
  const snapshot = JSON.stringify(tasks);
  let rules=cycleTaskLocalSort([], 'status');
  assert.deepEqual(sortTasksLocally(tasks,rules).map(t=>t.id),[2,3,1,4]);
  rules=cycleTaskLocalSort(rules,'owner');
  assert.deepEqual(sortTasksLocally(tasks,rules).map(t=>t.id),[3,4,2,1]);
  rules=cycleTaskLocalSort(rules,'status');
  assert.deepEqual(sortTasksLocally(tasks,rules).map(t=>t.id),[1,3,4,2]);
  rules=cycleTaskLocalSort(rules,'status');
  assert.equal(rules[0].value,'DELAYED');
  rules=cycleTaskLocalSort(rules,'status');
  assert.deepEqual(rules,[{field:'owner',value:'NS'}]);
  rules=cycleTaskLocalSort(rules,'owner');
  assert.equal(rules[0].value,'POCKET');
  rules=cycleTaskLocalSort(rules,'owner');
  assert.deepEqual(rules,[]);
  assert.equal(sortTasksLocally(tasks,rules),tasks);
  assert.equal(JSON.stringify(tasks),snapshot);
});
