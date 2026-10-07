export async function verifyChecklistSecurity(db, users, assert) {
  await db.exec('reset role;begin');
  const as = user => db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${users[user]}',false)`);
  const read = async (project = null, bucket = 'active', cursor = null) => (await db.query('select public.read_workspace_checklist($1,$2,$3::jsonb,10) v', [project, bucket, cursor ? JSON.stringify(cursor) : null])).rows[0].v;
  const save = async (id, version = null, project = 1, body = { date: '2026-10-08', title: 'QA follow-up', completed: false }, mutation = crypto.randomUUID(), kind = 'ITEM', operation = 'SAVE') => (await db.query('select public.save_workspace_checklist($1,$2,$3::uuid,$4::jsonb,$5,$6::uuid,$7) v', [kind, project, id, JSON.stringify(body), version, mutation, operation])).rows[0].v;
  const deny = async (fn, code = '42501') => {
    await db.exec('savepoint invalid'); let failure;
    try { await fn(); } catch (error) { failure = error; }
    await db.exec('rollback to invalid;release invalid');
    assert(failure?.code === code, `checklist expected ${code}, got ${failure?.code}: ${failure?.message}`);
  };
  try {
    await db.exec(`update public.projects set archived_at=null,status_code='ACTIVE' where id in (1,2);update public.profiles set archived_at=null,status_code='ACTIVE' where id in ('${users.ns}','${users.client}');update public.project_memberships set permission_code=case when user_id='${users.ns}' then 'EDIT' else 'READ_ONLY' end,allowed_pages=array['tasks'],status_code='ACTIVE',archived_at=null where project_id=1;update public.project_memberships set archived_at=now() where user_id='${users.ns}' and project_id<>1;`);
    await as('ns');
    const projects = (await read()).projects;
    assert(projects.length === 1 && projects[0].id === 1 && projects[0].canWrite, 'NS scoped projects');
    assert(typeof projects[0].navigation_id === 'string' && projects[0].navigation_id.length>0, 'canonical ID and app navigation ID both supplied');
    const ids = Array.from({ length: 13 }, () => crypto.randomUUID());
    for (const id of ids) await save(id);
    const first = await read(), next = await read(null, 'active', first.next_cursor);
    assert(first.items.length === 10 && next.items.length === 3 && !next.next_cursor && new Set([...first.items, ...next.items].map(i => i.id)).size === 13, 'ten rows with keyset continuation');
    const body = { date: '2026-10-08', title: 'done', completed: true }, mutation = crypto.randomUUID();
    let row = (await save(ids[0], 1, 1, body, mutation)).item;
    const replay = await save(ids[0], 1, 1, body, mutation);
    assert(replay.replayed && replay.item.row_version === 2 && replay.item.completed_at === row.completed_at, 'stable retry and server completion timestamp');
    await deny(() => save(ids[0], 2, 1, { ...body, title: 'different' }, mutation), '22023');
    await deny(() => save(ids[0], 1), '40001');
    row = (await save(ids[0], 2, 1, { ...body, title: 'renamed' })).item;
    assert(row.completed_at === replay.item.completed_at, 'title edit does not reset completion age');
    await db.exec(`reset role;update public.workspace_checklist set completed_at=now()-interval '7 days' where id='${ids[0]}';update public.workspace_checklist set completed_at=now()-interval '7 days'+interval '1 second' where id='${ids[1]}'`);
    await as('ns');
    assert((await read(null, 'completed')).items.length === 1 && (await read(null, 'completed')).items[0].id === ids[0], 'exact seven-day boundary');
    assert(!(await read()).items.some(i => i.id === ids[0]), 'completed bucket exclusion');
    await save(ids[0], 3);
    assert((await read(null, 'completed')).items.length === 0, 'uncheck restores active bucket');
    await deny(() => read(2));
    await deny(() => save(ids[0], 4, 2));
    await deny(() => db.query('select * from public.workspace_checklist'));
    await deny(() => db.query('select * from public.project_checklist_boards'));
    await deny(() => db.query('select * from private.checklist_audit'));
    let board = await save(null, null, 1, { text: 'https://example.test/admin\ninternal notes' }, crypto.randomUUID(), 'BOARD');
    assert(board.item.row_version === 1, 'board create');
    await deny(() => save(null, null, 1, { text: 'overwrite' }, crypto.randomUUID(), 'BOARD'), '40001');
    await deny(() => save(null, 1, 1, { text: 'x'.repeat(10001) }, crypto.randomUUID(), 'BOARD'), '22023');
    await deny(() => save(crypto.randomUUID(), null, 1, { ...body, completed_at: '2020-01-01' }), '22023');
    await save(ids[2], 1, 1, {}, crypto.randomUUID(), 'ITEM', 'ARCHIVE');
    await as('manager');
    let moved = (await save(ids[0], 4, 2)).item;
    assert(moved.project_id === 2 && (await read(2)).items.length === 1, 'one canonical row moves between project views');
    await as('ns');
    await deny(() => save(ids[0], moved.row_version, 1));
    await db.exec(`reset role;update public.project_memberships set permission_code='READ_ONLY' where project_id=1 and user_id='${users.ns}'`);
    await as('ns'); assert((await read()).projects[0].canWrite === false, 'readonly projection');
    await deny(() => save(crypto.randomUUID()));
    await as('client');
    await deny(() => read()); await deny(() => db.query('select public.read_checklist_board(1)')); await deny(() => save(crypto.randomUUID()));
    await db.exec(`reset role;update public.profiles set status_code='DISABLED' where id='${users.ns}'`);
    await as('ns'); await deny(() => read());
    await db.exec("reset role;set role anon;select set_config('request.jwt.claim.sub','',false)");
    await deny(() => read());
    console.log(JSON.stringify({ checklist: 'pagination, seven-day cutoff, reopen, project move, retry, conflicts, board, archive, NS/readonly/client/anon/disabled isolation passed' }));
  } finally { await db.exec('reset role;rollback'); }
}
