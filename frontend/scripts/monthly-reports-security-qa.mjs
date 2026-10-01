export async function verifyMonthlyReportsSecurity(db, users, assert) {
  await db.exec('reset role; begin');
  const as = user => db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${users[user]}',false);`);
  const query = async (sql, args = []) => (await db.query(sql, args)).rows[0].v;
  const list = (project = 1) => query('select public.list_monthly_reports($1) v', [project]);
  const read = (project = 1) => query("select public.read_monthly_report($1,'2026-09-01') v", [project]);
  const save = (version = null, published = false, mutation = crypto.randomUUID(), operation = 'SAVE', html = '<html><body>QA</body></html>') => query("select public.save_monthly_report(1,'2026-09-01','QA','report.html',$1,$2,$3,$4::uuid,$5) v", [html, published, version, mutation, operation]);
  const rejects = async (fn, code) => {
    await db.exec('savepoint invalid_request'); let error;
    try { await fn(); } catch (e) { error = e; }
    await db.exec('rollback to invalid_request; release invalid_request');
    assert(error?.code === code, `monthly reports expected ${code}, received ${error?.code}: ${error?.message}`);
  };
  try {
    await db.exec(`update public.projects set client_view_enabled=true where id=1; update public.project_memberships set allowed_pages=array['reports'],archived_at=null,status_code='ACTIVE' where project_id=1; update public.project_memberships set archived_at=now() where user_id='${users.ns}' and project_id<>1;`);
    await as('manager'); assert((await list()).items.length === 0, 'new reports not empty');
    const mutation = crypto.randomUUID();
    assert((await save(null, false, mutation)).row_version === 1, 'report not created');
    assert((await save(null, false, mutation)).row_version === 1, 'duplicate report on retry');
    await rejects(() => save(null, true, mutation), '22023');
    await rejects(() => save(0), '40001');
    await rejects(() => save(1, false, crypto.randomUUID(), 'SAVE', '<div>'+ 'x'.repeat(3145728) +'</div>'), '22023');
    await rejects(() => query("select public.read_monthly_report(1,'2026-09-12') v"), '22023');
    const metadata = (await list()).items[0]; assert(!('html' in metadata) && !('updated_by' in metadata), 'list leaked body/identity');
    await rejects(() => db.query('select * from public.monthly_marketing_reports'), '42501');
    await rejects(() => db.query('select * from private.monthly_report_audit'), '42501');
    await as('client'); assert((await list()).items.length === 0 && (await read()).item === null, 'unpublished leaked');
    await rejects(() => save(1), '42501'); await rejects(() => read(2), '42501');
    await as('ns'); assert((await list()).canWrite, 'NS cannot edit reports');
    await save(1, true);
    await as('client'); assert((await read()).item.html.includes('QA') && !(await list()).canWrite, 'published not readable/read-only');
    await db.exec(`reset role; update public.project_memberships set allowed_pages=array['progress'] where project_id=1 and user_id='${users.client}';`);
    await as('client'); await rejects(()=>read(),'42501');
    await db.exec(`reset role; update public.project_memberships set allowed_pages=array['tasks'] where project_id=1 and user_id='${users.client}';`);
    await as('client'); await rejects(()=>read(),'42501');
    await db.exec(`reset role; update public.project_memberships set allowed_pages=array['performance'] where project_id=1 and user_id='${users.client}';`);
    await as('client'); await rejects(()=>read(),'42501');
    await db.exec(`reset role; update public.project_memberships set allowed_pages=array['reports'] where project_id=1 and user_id='${users.client}';`);
    await as('client'); assert((await read()).item?.published,'reports-only client cannot read published report');
    await rejects(()=>db.query('select public.read_client_progress(1)'), '42501');
    await rejects(()=>db.query('select public.read_task_workspace(1,false)'), '42501');
    const bootstrap=await query('select public.read_bootstrap() v');
    assert(bootstrap.projects.some(p=>p.allowed_pages.includes('reports')),'report-only account lost project at bootstrap');
    await db.exec(`reset role; update public.project_memberships set allowed_pages=array['overview'] where project_id=1 and user_id='${users.client}';`);
    await as('client'); await rejects(() => list(), '42501');
    await db.exec(`reset role; update public.project_memberships set allowed_pages=array['reports'] where project_id=1 and user_id='${users.client}'; update public.projects set client_view_enabled=false where id=1;`);
    await as('client'); await rejects(() => read(), '42501');
    await as('manager'); const archiveId = crypto.randomUUID();
    await save(2, false, archiveId, 'ARCHIVE', null);
    assert((await save(2, false, archiveId, 'ARCHIVE', null)).archived, 'archive retry failed');
    assert((await list()).items.length === 0 && (await read()).item === null, 'archived visible');
    assert((await save(null, true)).row_version === 4, 'reupload archived month not possible');
    await db.exec("reset role; set role anon; select set_config('request.jwt.claim.sub','',false);");
    await rejects(() => list(), '42501');
    await db.exec(`reset role; update public.profiles set status_code='DISABLED' where id='${users.ns}';`);
    await as('ns'); await rejects(() => list(), '42501');
    console.log(JSON.stringify({ monthlyReports: 'create/publish/replace/archive/reupload and idempotency pass', customerReportIsolation: 'cross-project/draft/disabled/anonymous/direct table access blocked' }));
  } finally { await db.exec('reset role; rollback'); }
}
