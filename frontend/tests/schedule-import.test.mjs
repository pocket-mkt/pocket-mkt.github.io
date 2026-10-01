import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScheduleHtml, readScheduleFile, prepareScheduleRows, createScheduleImportPlan, runScheduleImportPlan, matchScheduleProject } from '../src/scheduleImport.js';
import { tasksViewModel } from '../src/api/viewModel.js';
import { scheduleFixture, scheduleHtml } from './fixtures/schedule-import.mjs';

test('schedule HTML extracts only JSON; preserves sparse/empty dates, negative offsets, owners and month', async () => {
  const parsed = parseScheduleHtml(scheduleHtml(scheduleFixture()));
  assert.equal(globalThis.scheduleHtmlExecuted, undefined);
  assert.equal(parsed.total, 43);
  const campaign = parsed.campaigns[0], rows = await prepareScheduleRows(campaign, campaign.month);
  assert.deepEqual(rows[0].dates, ['2026-09-30','2026-10-01','2026-10-06']);
  assert.equal(rows[0].fields.execution_month, '2026-10-01');
  assert.equal(rows[0].fields.responsible_org_code, 'NS');
  assert.equal(rows[1].fields.responsible_org_code, 'POCKET');
  assert.equal(rows[1].fields.planned_start_date, null);
  assert.equal(rows[1].fields.due_date, null);
  assert.equal(rows[1].fields.schedule_dates_json, '[]');
  assert.deepEqual(rows.slice(0,5).map(row=>row.fields.category_code), ['WEBSITE','YOUTUBE','INSTAGRAM','NAVER_BLOG','ADS']);
  assert.match(rows[2].fields.remarks, /원본 상위 업무: QA 업무 1/);
  assert.equal(rows[2].fields.parent_task_id, undefined);
  const plan = createScheduleImportPlan({projectId:'1',month:campaign.month,rows,lastOrder:100});
  assert.equal(plan.mutations.length,43);
  assert.ok(plan.mutations.every(item=>item.fields.visibility_code==='PROJECT_TEAM'));
  assert.equal(plan.mutations[0].fields.sort_order,110);
  rows[0].fields.status_code='DONE';
  assert.equal(createScheduleImportPlan({projectId:1,month:campaign.month,rows:[rows[0]]}).mutations[0].fields.progress_percent,100);
});

test('legacy date bounds fallback only when days absent; unsupported/invalid input rejects before any write', () => {
  const data=scheduleFixture(1), row=data.campaigns[0].rows[0];
  delete row.days;row.end='2026-10-03';
  assert.equal(parseScheduleHtml(scheduleHtml(data)).campaigns[0].rows[0].dates.length,3);
  row.end='2026-09-30';assert.throws(()=>parseScheduleHtml(scheduleHtml(data)),/시작일과 종료일/);
  row.end='2026-10-03';row.start='2026-02-30';assert.throws(()=>parseScheduleHtml(scheduleHtml(data)),/날짜/);
  row.start='2026-10-01';row.owner='미확인';assert.throws(()=>parseScheduleHtml(scheduleHtml(data)),/담당/);
  row.owner='NS';row.link='javascript:alert(1)';assert.throws(()=>parseScheduleHtml(scheduleHtml(data)),/https/);
  row.link='';row.days=[0,1.5];assert.throws(()=>parseScheduleHtml(scheduleHtml(data)),/날짜/);
  row.days=[0];row.parentId=row.id;assert.throws(()=>parseScheduleHtml(scheduleHtml(data)),/자기 자신/);
  assert.throws(()=>parseScheduleHtml('<html><script>alert(1)</script></html>'),/데이터를 찾지/);
  assert.throws(()=>parseScheduleHtml('<script id="seed" type="application/json">{bad}</script>'),/손상/);
  assert.throws(()=>parseScheduleHtml(scheduleHtml(scheduleFixture())+scheduleHtml(scheduleFixture())),/데이터를 찾지/);
  assert.throws(()=>parseScheduleHtml(scheduleHtml(scheduleFixture(1001))),/1000/);
});

test('file validation and project matching', async () => {
  await assert.rejects(readScheduleFile(new File(['bad'],'bad.txt')),/HTML/);
  await assert.rejects(readScheduleFile(new File([new Uint8Array([255])],'bad.html')),/UTF-8/);
  const parsed=await readScheduleFile(new File([scheduleHtml(scheduleFixture(1))],'schedule.html'));
  assert.equal(parsed.fileName,'schedule.html');
  const projects=[{id:1,clientName:'다른 회사'},{id:2,clientName:'일정 QA'}];
  assert.equal(matchScheduleProject(parsed.campaigns[0],projects,1),'2');
  assert.equal(matchScheduleProject({name:'다른 파일'},projects,1),'1');
});

test('reopening skips existing source IDs including edited tasks; exact legacy duplicates also skipped', async () => {
  const campaign=parseScheduleHtml(scheduleHtml(scheduleFixture(3))).campaigns[0];
  const rows=await prepareScheduleRows(campaign,campaign.month);
  const tasks=tasksViewModel({data:{items:rows.map((row,index)=>({...row.fields,task_id:index+1}))}}).items;
  tasks[0].title='사용자가 수정한 제목';tasks[1].sourceTaskId=null;
  const duplicate=await prepareScheduleRows(campaign,campaign.month,tasks);
  assert.ok(duplicate.every(row=>row.duplicate));
  assert.equal(createScheduleImportPlan({projectId:1,month:campaign.month,rows:duplicate}).mutations.length,0);
  const nextMonth=await prepareScheduleRows(campaign,'2026-11',tasks);
  assert.ok(nextMonth.every(row=>!row.duplicate));
  assert.notEqual(rows[0].fields.source_task_id,nextMonth[0].fields.source_task_id);
});

test('40+3 batches, failure keeps confirmed offset and retries identical mutation IDs', async () => {
  const campaign=parseScheduleHtml(scheduleHtml(scheduleFixture())).campaigns[0];
  const plan=createScheduleImportPlan({projectId:1,month:campaign.month,rows:await prepareScheduleRows(campaign,campaign.month)});
  const calls=[];let fail=true;
  const save=async chunk=>{calls.push(chunk.map(item=>item.mutationId));if(calls.length===2&&fail){fail=false;throw Error('lost response');}};
  await assert.rejects(runScheduleImportPlan(plan,save),/lost response/);
  assert.equal(plan.offset,40);assert.equal(plan.attempted,true);
  const result=await runScheduleImportPlan(plan,save);
  assert.equal(result.count,43);assert.deepEqual(calls.map(chunk=>chunk.length),[40,3,3]);assert.deepEqual(calls[1],calls[2]);
  await runScheduleImportPlan(plan,save);assert.equal(calls.length,3);
});
