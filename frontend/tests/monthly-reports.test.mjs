import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_REPORT_BYTES, validateReportFile, REPORT_CSP, reportMonthLabel, reportDocument } from '../src/monthlyReports.js';
import { createMonthlyReportsApi } from '../src/supabase/monthlyReportsApi.js';
import { parseViewLocation, viewLocationHash } from '../src/planNavigation.js';

test('monthly report route preserves navigation and literal month labels', () => {
  assert.equal(parseViewLocation('#reports').view, 'reports');
  assert.equal(viewLocationHash('reports'), 'reports');
  assert.equal(reportMonthLabel('2026-09'), '2026년 9월');
});
test('HTML report accepts only bounded standalone HTML', () => {
  validateReportFile({ name: '보고서.html', size: 100 }, '<html><body>보고서</body></html>');
  assert.throws(() => validateReportFile({ name: 'bad.txt', size: 20 }, '<html/>'));
  assert.throws(() => validateReportFile({ name: 'big.html', size: MAX_REPORT_BYTES + 1 }, '<html>'));
  assert.throws(() => validateReportFile({ name: 'empty.html', size: 20 }, 'not a report'));
  assert.throws(() => validateReportFile({ name: 'bad.html', size: 20 }, '<div>\u0000</div>'));
  assert.throws(() => validateReportFile({ name: 'big.html', size: 1 }, '<div>'+ '한'.repeat(MAX_REPORT_BYTES / 2) +'</div>'));
  assert.match(REPORT_CSP, /connect-src 'none'/);
  assert.match(REPORT_CSP, /base-uri 'none'/);
  assert.match(REPORT_CSP, /form-action 'none'/);
  const html = '<html><body class="original-layout"><script>fixture()</script></body></html>';
  const doc = reportDocument(html);
  assert.ok(doc.endsWith(html));
  assert.ok(doc.indexOf('Content-Security-Policy') < doc.indexOf('<script>'));
});
test('reports use scoped RPCs, versions, cancellation and no raw error output', async () => {
  const calls = [], signal = new AbortController().signal;
  const api = createMonthlyReportsApi({ rpc: (name, args) => {
    calls.push({ name, args });
    return { abortSignal: got => { assert.equal(got, signal); return Promise.resolve({ data: { items: [] } }); }, then: resolve => resolve({ data: { saved: true } }) };
  } });
  await api.list({ projectId: 3, signal, beforeMonth: '2026-09' });
  await api.read({ projectId: 3, month: '2026-10', signal });
  await api.save({ projectId: 3, month: '2026-10', html: '<div>report</div>', fileName: 'report.html', title: 'Report', rowVersion: 2, mutationId: 'retry-id' });
  assert.deepEqual(calls[0], { name: 'list_monthly_reports', args: { p_project_id: 3, p_before_month: '2026-09-01' } });
  assert.equal(calls[1].args.p_month, '2026-10-01');
  assert.equal(calls[2].args.p_expected_version, 2);
  assert.equal(calls[2].args.p_mutation_id, 'retry-id');
  for (const code of ['42501','40001','22023']) {
    const bad = createMonthlyReportsApi({ rpc: () => Promise.resolve({ error: { code, message: 'private raw error' } }) });
    await assert.rejects(() => bad.save({ projectId: 3, month: '2026-10' }), error => !error.message.includes('private raw error') && error.code === ({'42501':'forbidden','40001':'conflict'}[code] || code));
  }
});
