export async function verifyChecklistTasks(db, users, assert) {
 await db.exec('reset role;begin');
 const as = user => db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${users[user]}',false)`);
 const read = async (bucket='active',cursor=null,project=null) => (await db.query('select public.read_checklist_feed($1,$2,$3::jsonb,10) v',[project,bucket,cursor?JSON.stringify(cursor):null])).rows[0].v;
 const mutate = async (id,version,fields,project=1,mutation=crypto.randomUUID()) => (await db.query('select public.mutate_task($1,$2,$3,$4,$5,$6::jsonb) v',[mutation,id?'UPDATE':'CREATE',project,id,version,JSON.stringify(fields)])).rows[0].v;
 const denied = async fn => { await db.exec('savepoint denied'); let error; try { await fn(); } catch(e) { error=e; } await db.exec('rollback to denied;release denied'); assert(error?.code==='42501','feed authorization denied'); };
 const seed = {title:'registered task',phase_code:'EXECUTION',workstream_code:'MARKETING',responsible_org_code:'NS',reviewer_org_code:'POCKET',status_code:'IN_PROGRESS',visibility_code:'PROJECT_TEAM',execution_month:'2026-10-01',schedule_dates_json:['2026-10-07','2026-10-09'],category_code:'INSTAGRAM'};
 try {
  await db.exec(`update public.projects set archived_at=null,status_code='ACTIVE' where id in(1,2);update public.clients set archived_at=null,status_code='ACTIVE';update public.tasks set archived_at=now();update public.workspace_checklist set archived_at=now();update public.profiles set archived_at=null,status_code='ACTIVE' where id in('${users.ns}','${users.client}');update public.project_memberships set permission_code=case when user_id='${users.ns}' then 'EDIT' else 'READ_ONLY' end,allowed_pages=array['tasks'],status_code='ACTIVE',archived_at=null where project_id=1;update public.project_memberships set archived_at=now() where user_id='${users.ns}' and project_id<>1;`);
  await as('ns');
  const records=[];
  for(let i=0;i<12;i++) { const r=await mutate(null,null,{...seed,title:`registered ${i}`,...(i===11?{schedule_dates_json:[]}: {})}); assert(r.ok,'create task fixture'); records.push(r.data.item); }
  await db.query("select public.save_workspace_checklist('ITEM',1,$1::uuid,$2::jsonb,null,$3::uuid,'SAVE')",[crypto.randomUUID(),JSON.stringify({date:'2026-10-08',title:'manual',completed:false}),crypto.randomUUID()]);
  const first=await read(),second=await read('active',first.next_cursor),all=[...first.items,...second.items];
  assert(first.items.length===10&&second.items.length===3&&!second.next_cursor&&new Set(all.map(r=>r.id)).size===13,'mixed feed pagination');
  assert(all.filter(r=>r.row_kind==='TASK').length===12&&all.filter(r=>r.row_kind==='ITEM').length===1&&first.summary.pending===13,'canonical tasks and manual items together');
  assert(all.at(-1).task_date===null,'undated task included last');
  const target=records[0],mutation=crypto.randomUUID(),completed=await mutate(target.id,target.row_version,{status_code:'DONE'},1,mutation);
  assert(completed.ok&&completed.data.item.schedule_dates.join()===target.schedule_dates.join()&&completed.data.item.category_code==='INSTAGRAM','completion leaves schedule and media unchanged');
  assert((await mutate(target.id,target.row_version,{status_code:'DONE'},1,mutation)).ok,'task retry stable');
  const a=await read(),b=await read('active',a.next_cursor),done=[...a.items,...b.items].find(r=>r.id===`task:${target.id}`);
  assert(done?.is_complete&&done.completed_by_name&&a.summary.pending===12,'task completion and checker from canonical audit');
  await db.exec(`reset role;update public.tasks set completed_at=now()-interval '8 days' where id=${target.id}`);
  await as('ns');
  const completedPage=await read('completed'); assert(completedPage.items.length===1&&completedPage.items[0].source_id===String(target.id),'seven-day task archive');
  const version=completedPage.items[0].row_version;
  const reopened=await mutate(target.id,version,{status_code:'IN_PROGRESS'}); assert(reopened.ok&&!reopened.data.item.completed_at&&(await read('completed')).items.length===0,'reopen original task');
  const stale=await mutate(target.id,target.row_version,{status_code:'DONE'}); assert(!stale.ok&&stale.error.code==='stale_row_version','stale task check rejected');
  await as('manager');
  const hidden=(await mutate(null,null,{...seed,title:'private',visibility_code:'POCKET_ONLY'})).data.item;
  await mutate(null,null,{...seed,title:'other project'},2);
  await as('ns'); const scope=await read(); assert(scope.summary.pending===13&&!scope.items.some(r=>r.source_id===String(hidden.id)),'no Pocket-only or cross-project summary leakage'); await denied(()=>read('active',null,2));
  await db.exec(`reset role;update public.project_memberships set permission_code='READ_ONLY' where project_id=1 and user_id='${users.ns}'`); await as('ns');
  assert((await read()).projects[0].canWrite===false,'readonly feed'); await denied(()=>mutate(target.id,reopened.data.item.row_version,{status_code:'DONE'}));
  await as('client'); await denied(()=>read());
  await db.exec(`reset role;update public.profiles set status_code='DISABLED' where id='${users.ns}'`); await as('ns'); await denied(()=>read());
  await db.exec("reset role;set role anon;select set_config('request.jwt.claim.sub','',false)"); await denied(()=>read());
  console.log('Registered checklist tasks: original task+manual pagination, undated, completion/reopen/retry, schedule preservation, audit identity, readonly/private/client/anon isolation passed');
 } finally { await db.exec('rollback;reset role'); }
}
