import test from 'node:test';
import assert from 'node:assert/strict';
import { checklistBucket, checklistDraft, checklistRequest, checklistToday, boardSegments, checklistProjectRoute } from '../src/checklistModel.js';
import { createChecklistApi } from '../src/supabase/checklistApi.js';
import { isViewAllowed, ACCESS_PAGE_KEYS } from '../src/accessPermissions.js';
import { parseViewLocation } from '../src/planNavigation.js';

test('checklist uses seven elapsed days and keeps recent completions', () => {
 const now = Date.parse('2026-10-08T03:00:00Z');
 assert.equal(checklistBucket({}, now), 'active');
 assert.equal(checklistBucket({ completed_at: '2026-10-01T03:00:01Z' }, now), 'active');
 assert.equal(checklistBucket({ completed_at: '2026-10-01T03:00:00Z' }, now), 'completed');
 assert.equal(checklistToday(new Date('2026-10-07T16:00:00Z')), '2026-10-08');
});
test('checklist request copies canonical version and never sends client timestamps', () => {
 assert.equal(checklistProjectRoute({id:1,navigation_id:'PRJ-UND'}),'PRJ-UND');
 assert.equal(checklistProjectRoute({id:4}),'4');
 const row = { id: crypto.randomUUID(), project_id: 2, task_date: '2026-10-08', title: 'follow up', completed_at: '2026-10-08T01:00:00Z', row_version: 9 };
 const draft = checklistDraft(row), request = checklistRequest(draft, row);
 assert.equal(request.rowVersion, 9); assert.equal(request.id, row.id);
 assert.deepEqual(request.body, { date: row.task_date, title: row.title, completed: true });
 assert.notEqual(checklistRequest(draft).id, row.id);
});
test('board only links safe HTTP(S), never interprets markup or credential URLs', () => {
 const parts = boardSegments('<img src=x onerror=alert(1)> javascript:alert(1) https://user:pass@example.test https://example.test/admin');
 assert.equal(parts.filter(p => p.href).length, 1); assert.equal(parts.at(-1).href, 'https://example.test/admin');
 assert.ok(parts[0].text.includes('<img'));
});
test('checklist route is internal default and never a customer grant', () => {
 assert.equal(parseViewLocation('').view, 'checklist');
 assert.equal(parseViewLocation('#portfolio').view, 'portfolio');
 assert.equal(parseViewLocation('#checklist').view, 'checklist');
 assert.equal(isViewAllowed('checklist', ['checklist', ...ACCESS_PAGE_KEYS]), false);
 assert.equal(ACCESS_PAGE_KEYS.includes('checklist'), false);
});
test('checklist RPC adapter preserves pagination and mutation envelope', async () => {
 const calls = [], client = { rpc(name, args) { calls.push({ name, args }); return Promise.resolve({ data: { items: [] } }); } };
 const api = createChecklistApi(client), cursor = { date: '2026-10-08', id: crypto.randomUUID() };
 await api.list({ projectId: 2, bucket: 'completed', cursor });
 assert.deepEqual(calls[0].args, { p_project_id: 2, p_bucket: 'completed', p_cursor: cursor, p_limit: 10 });
 const input = checklistRequest(checklistDraft(null, 2)); input.body.title = 'hello';
 await api.save(input); await api.save(input);
 assert.deepEqual(calls[1], calls[2]);
 await api.board({ projectId: 2 }); assert.equal(calls[3].name, 'read_checklist_board');
});
test('checklist conflict/denial errors are safe and actionable', async () => {
 for (const [code, mapped] of [['40001', 'conflict'], ['42501', 'forbidden']]) {
  const api = createChecklistApi({ rpc: () => Promise.resolve({ error: { code, message: 'raw private payload' } }) });
  await assert.rejects(api.list(), e => e.code === mapped && !e.message.includes('raw private'));
 }
});
