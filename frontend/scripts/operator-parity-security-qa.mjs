export async function verifyOperatorParity(db,users,assert){
  const as=async user=>db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${users[user]}',false)`);
  const one=async(sql,args=[]) => (await db.query(sql,args)).rows[0].v;
  const deny=async fn=>{await db.exec('savepoint boundary');let error;try{await fn();}catch(e){error=e;}await db.exec('rollback to boundary; release boundary');assert(error?.code==='42501','unauthorized operation allowed: '+error?.code);};
  await db.exec('reset role; begin');
  try{
    await db.exec("update public.projects set client_view_enabled=true where id=1; update public.project_memberships set permission_code=case when user_id='"+users.ns+"' then 'EDIT' else permission_code end,allowed_pages=array['tasks','daily','progress'],status_code='ACTIVE',archived_at=null where project_id=1");
    const task=(id,op,row,fields)=>one('select public.mutate_task($1,$2,1,$3,$4,$5) v',[id,op,row?.id||null,row?.row_version||null,JSON.stringify(fields)]);
    await as('manager');
    const visible=(await task('qa-parity-create-public','CREATE',null,{title:'QA parity task',visibility_code:'CLIENT'})).data.item;
    const pocket=(await task('qa-parity-create-pocket','CREATE',null,{title:'QA private task',visibility_code:'POCKET_ONLY'})).data.item;
    await as('ns');
    const hidden=await task('qa-parity-hide','UPDATE',visible,{visibility_code:'PROJECT_TEAM'});assert(hidden.ok&&hidden.data.item.visibility_code==='PROJECT_TEAM','NS task hiding failed');
    const retry=await task('qa-parity-hide','UPDATE',visible,{visibility_code:'PROJECT_TEAM'});assert(retry.data.item.row_version===hidden.data.item.row_version,'hide retry repeated write');
    await as('client');assert(!(await one('select public.read_client_progress(1) v')).items.some(t=>t.title==='QA parity task'),'hidden task leaked');
    await as('ns');
    const restored=await task('qa-parity-show','UPDATE',hidden.data.item,{visibility_code:'CLIENT'});assert(restored.ok,'NS re-publication failed');
    assert(!(await task('qa-parity-escalate','UPDATE',restored.data.item,{visibility_code:'POCKET_ONLY'})).ok,'NS chose Pocket-only');
    assert(!(await task('qa-parity-private-edit','UPDATE',pocket,{visibility_code:'CLIENT'})).ok,'NS published private task');
    assert(!(await task('qa-parity-private-archive','ARCHIVE',pocket,{})).ok,'NS archived private task');
    const undo=await one("select public.undo_task_changes(1,array['qa-parity-show'],'qa-parity-undo') v");assert(undo.ok,'NS visibility undo failed');
    await as('client');assert(!(await one('select public.read_client_progress(1) v')).items.some(t=>t.title==='QA parity task'),'undo did not restore hiding');
    await as('ns');
    const meeting=await one("select public.mutate_daily_meeting('qa-parity-meeting','CREATE',1,null,null,'{\"title\":\"QA meeting\",\"discussion_text\":\"QA\",\"meeting_date\":\"2026-10-01\",\"visibility_code\":\"CLIENT\"}') v");assert(meeting.ok,'NS public meeting creation blocked');
    assert((await one("select public.mutate_daily_meeting('qa-parity-meeting-hide','UPDATE',1,$1,$2,'{\"visibility_code\":\"PROJECT_TEAM\"}') v",[meeting.data.item.id,meeting.data.item.row_version])).ok,'NS meeting hiding blocked');
    await db.exec('reset role');const version=await one('select row_version v from public.projects where id=1');
    await as('ns');
    const project=await one("select public.update_project_start_date('qa-parity-start',1,$1,'2026-09-01') v",[version]);assert(project.ok&&project.data.item.row_version>version,'NS start date did not save');
    const repeated=await one("select public.update_project_start_date('qa-parity-start',1,$1,'2026-09-01') v",[version]);assert(repeated.data.item.row_version===project.data.item.row_version,'start date retry not idempotent');
    await db.exec('reset role');assert((await one("select count(*)::int v from public.activity_events where entity_type='TASK' and mutation_id='qa-parity-hide' and actor_user_id=$1",[users.ns]))===1,'hide audit missing/duplicated');
    const roles=await one("select role_code v from public.profiles where id=$1",[users.ns]);assert(roles==='EXECUTOR_EDITOR','NS promoted to admin');
    await db.exec(`update public.project_memberships set permission_code='READ_ONLY' where project_id=1 and user_id='${users.ns}'`);
    await as('ns');await deny(()=>one("select public.update_project_start_date('qa-parity-deny',1,$1,'2026-09-01') v",[project.data.item.row_version]));
    await deny(()=>task('qa-parity-deny-task','UPDATE',hidden.data.item,{visibility_code:'CLIENT'}));
    await as('client');await deny(()=>one("select public.update_project_start_date('qa-parity-client',1,$1,'2026-09-01') v",[project.data.item.row_version]));
    console.log('Operator parity: NS hide/show/retry/audit/undo, meeting visibility and native project start date; private/read-only/client boundaries passed');
  }finally{await db.exec('reset role; rollback');}
}
