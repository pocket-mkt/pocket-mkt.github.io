import { parseScheduleHtml, prepareScheduleRows, createScheduleImportPlan, runScheduleImportPlan } from '../src/scheduleImport.js';
import { createSupabaseTaskBatchMutator } from '../src/supabase/taskMutation.js';
import { tasksViewModel } from '../src/api/viewModel.js';
import { scheduleFixture, scheduleHtml } from '../tests/fixtures/schedule-import.mjs';

export async function verifyScheduleImport(db, users, assert) {
  await db.exec('reset role; begin');
  const as = user => db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${users[user]}',false)`);
  const mutate = createSupabaseTaskBatchMutator({ rpc: async (name,args) => {
    assert(name==='mutate_tasks_batch','unexpected schedule import RPC');
    try {return {data:(await db.query('select public.mutate_tasks_batch($1,$2::jsonb) v',[args.p_project_id,JSON.stringify(args.p_mutations)])).rows[0].v,error:null};}
    catch(error){return {data:null,error};}
  }});
  try {
    await db.exec(`update public.projects set client_view_enabled=true where id=1; update public.project_memberships set allowed_pages=array['tasks'],archived_at=null,status_code='ACTIVE' where project_id=1;`);
    await as('ns');
    const campaign=parseScheduleHtml(scheduleHtml(scheduleFixture())).campaigns[0];
    const rows=await prepareScheduleRows(campaign,campaign.month), plan=createScheduleImportPlan({projectId:1,month:campaign.month,rows});
    const records=[];
    await runScheduleImportPlan(plan, async mutations => {const result=await mutate({projectId:1,mutations});records.push(...result.data.results.map(item=>item.record));});
    assert(records.length===43,'schedule import did not create exactly 43 records');
    const view=tasksViewModel({data:{items:records}}).items;
    const first=view.find(item=>item.title==='QA 업무 1'), empty=view.find(item=>item.title==='QA 업무 2');
    assert(first.executionMonth==='2026-10-01' && JSON.stringify(first.scheduleDates)===JSON.stringify(['2026-09-30','2026-10-01','2026-10-06']),'DB lost month/sparse dates');
    assert(empty.plannedStartDate===null&&empty.dueDate===null&&empty.scheduleDates.length===0,'DB filled unspecified schedule');
    await mutate({projectId:1,mutations:plan.mutations.slice(0,40)});
    const workspace=(await db.query('select public.read_task_workspace(1,false) v')).rows[0].v;
    const restored=tasksViewModel({data:workspace}).items;
    const duplicates=await prepareScheduleRows(campaign,campaign.month,restored);
    assert(duplicates.every(row=>row.duplicate),'canonical workspace failed duplicate detection');
    await db.exec('reset role');
    const count=(await db.query("select count(*)::int n from public.tasks where project_id=1 and source_task_id like 'schedule-html:%'")).rows[0].n;
    assert(count===43,'retry duplicated records');
    const audit=(await db.query("select count(*)::int n from public.activity_events where entity_type='TASK' and action_code='CREATED' and entity_id=any($1::bigint[])",[records.map(row=>String(row.task_id))])).rows[0].n;
    assert(audit>=43,'imports lack creation audit');
    await as('client');
    const client=(await db.query('select public.read_client_progress(1) v')).rows[0].v;
    assert(!client.items.some(row=>row.title?.startsWith('QA 업무')),'default-hidden imports leaked to customer');
    const blocked=createScheduleImportPlan({projectId:1,month:'2026-11',rows:await prepareScheduleRows(campaign,'2026-11')});
    await db.exec('savepoint forbidden_import');let denied=false;
    try {await mutate({projectId:1,mutations:blocked.mutations.slice(0,1)});}catch{denied=true;}
    await db.exec('rollback to forbidden_import; release forbidden_import');
    assert(denied,'customer can import schedules');
    console.log(JSON.stringify({scheduleImport:'43 canonical creates, sparse/empty dates, execution month, retry/dedup, audit and customer isolation pass'}));
  } finally {await db.exec('rollback');await db.exec('reset role');}
}
