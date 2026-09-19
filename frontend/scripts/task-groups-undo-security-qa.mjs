export async function verifyTaskGroupsUndo(db, users, assert) {
  await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${users.manager}',false);`);
  const rpc = async sql => (await db.query(sql)).rows[0].result;
  const create = async (mid, title) => {
    const result = await rpc(`select public.mutate_task('${mid}','CREATE',1,null,null,'${JSON.stringify({title, schedule_dates:['2040-09-01','2040-09-03'], status_code:'NOT_STARTED',visibility_code:'PROJECT_TEAM'})}'::jsonb) result`);
    assert(result.ok, JSON.stringify(result)); return result.data.item;
  };
  const update = async (task,mid,fields) => {
    const result = await rpc(`select public.mutate_task('${mid}','UPDATE',1,${task.id},${task.row_version},'${JSON.stringify(fields)}'::jsonb) result`);
    assert(result.ok, JSON.stringify(result)); return result.data.item;
  };
  const undo = (ids, key) => rpc(`select public.undo_task_changes(1,array[${ids.map(id=>`'${id}'`).join(',')}],'${key}') result`);
  const row = async id => {
    await db.exec('reset role');
    const record=(await db.query(`select * from public.tasks where id=${id}`)).rows[0];
    await db.exec('set role authenticated'); return record;
  };
  const deny = async (run,label) => { let denied=false; try {await run();} catch {denied=true;} assert(denied,label); };
  let a=await create('qa-group-create-a','그룹 테스트 A'), b=await create('qa-group-create-b','그룹 테스트 B');
  const group={task_group_id:'10000000-0000-4000-8000-000000000099',task_group_name:'외부유입'};
  a=await update(a,'qa-group-assign-a',group); b=await update(b,'qa-group-assign-b',group);
  assert(a.task_group_name==='외부유입' && a.schedule_dates.length===2,'group changed dates');
  const read=await rpc('select public.read_tasks(1,false) result');
  assert(JSON.stringify(read).includes('외부유입'),'group missing from read/reload');
  const activity=await rpc('select public.read_task_activity(1,100,null,null) result');
  assert(JSON.stringify(activity).includes('task_group_name'),'group missing from activity log');
  await undo(['qa-group-assign-a','qa-group-assign-b'],'qa-undo-group');
  a=await row(a.id);b=await row(b.id);
  assert(!a.task_group_id&&!b.task_group_id&&a.schedule_dates.length===2,'group undo failed');
  const version=a.row_version;
  await undo(['qa-group-assign-a','qa-group-assign-b'],'qa-undo-group');
  assert((await row(a.id)).row_version===version,'undo retry mutated twice');
  a=await update(a,'qa-hold-before',{status_code:'ON_HOLD',schedule_dates:['2026-09-01','2026-09-03']});
  const before=await row(a.id);
  a=await update(a,'qa-resume-now',{status_code:'IN_PROGRESS',schedule_dates:['2040-09-05','2040-09-08']});
  await undo(['qa-resume-now'],'qa-undo-resume');a=await row(a.id);
  for(const key of ['status_code','status_mode','schedule_dates','planned_start_date','due_date','completed_at','overdue_hold_ranges','overdue_hold_resolved_at']) assert(JSON.stringify(a[key])===JSON.stringify(before[key]),'undo mismatch '+key);
  a=await update(a,'qa-stale-first',{title:'먼저 수정'});
  a=await update(a,'qa-stale-later',{title:'나중 수정'});
  await deny(()=>undo(['qa-stale-first'],'qa-undo-conflict'),'stale undo allowed');
  assert((await row(a.id)).title==='나중 수정','conflict overwrote task');
  // Later conflict rolls back earlier members too.
  b=await update(b,'qa-atomic-b',{title:'B 변경'});
  await deny(()=>undo(['qa-atomic-b','qa-stale-first'],'qa-undo-atomic'),'partial undo allowed');
  assert((await row(b.id)).title==='B 변경','atomic undo partially committed');
  await db.exec(`select set_config('request.jwt.claim.sub','${users.ns}',false);`);
  await deny(()=>undo(['qa-stale-later'],'qa-undo-other-user'),'other user undo allowed');
  await deny(()=>db.exec('select * from private.task_undo_context'),'private snapshot leaked');
  await db.exec(`select set_config('request.jwt.claim.sub','${users.client}',false);`);
  await deny(()=>undo(['qa-stale-later'],'qa-undo-client'),'client undo allowed');
  await db.exec(`select set_config('request.jwt.claim.sub','${users.manager}',false);`);
  const c=await create('qa-create-to-undo','생성 취소');
  await undo(['qa-create-to-undo'],'qa-undo-create');
  assert((await row(c.id)).archived_at,'create undo did not archive');
  let d=await create('qa-create-archive','삭제 복구');
  const archived=await rpc(`select public.mutate_task('qa-archive-task','ARCHIVE',1,${d.id},${d.row_version},'{}') result`);
  assert(archived.ok,'archive failed');
  await undo(['qa-archive-task'],'qa-undo-archive');
  assert(!(await row(d.id)).archived_at,'archive undo failed');
  await db.exec('reset role');
  assert((await db.query('select count(*)::int n from private.task_undo_context')).rows[0].n===0,'context not cleared');
  console.log('Task groups/undo: grouping, sparse dates, exact holds, atomicity, stale versions, ownership, archive/create, idempotency passed');
}
