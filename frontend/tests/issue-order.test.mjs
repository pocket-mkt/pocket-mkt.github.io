import test from 'node:test';
import assert from 'node:assert/strict';
import { newestIssuesFirst } from '../src/issueOrder.js';

test('확인 요청은 수정일/마감일이 아닌 작성일시 최신순이며 원본을 보존한다', () => {
  const items = [
    { id: 1, createdAt: '2026-09-08T01:00:00Z', updatedAt: '2026-09-10T00:00:00Z', dueDate: '2026-09-08' },
    { id: 2, createdAt: '2026-09-08T12:00:00+09:00', dueDate: '2026-10-10' },
    { id: 3, createdAt: '2026-09-08T02:00:00Z' },
  ];
  assert.deepEqual(newestIssuesFirst(items).map(item => item.id), [2, 3, 1]);
  assert.deepEqual(items.map(item => item.id), [1, 2, 3]);
});

test('이전 자료는 등록일로 보완하고 날짜 없는 항목은 마지막, 동률은 안정 정렬한다', () => {
  const items = [{id: 1}, {id: 2, createdAt: 'invalid', date: '2026-09-08'}, {id: 3, createdAt: '2026-09-07T16:00:00Z'}, {id: 4, date: '2026-09-08'}];
  assert.deepEqual(newestIssuesFirst(items).map(item => item.id), [3, 2, 4, 1]);
});
