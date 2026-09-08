import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { appendBriefReply, briefRequestFields, briefWeek, latestBriefMeeting, progressBriefTasks, publicHttpLink, requestDeadlineFields, requestDeadlineLabel } from "../src/progressBrief.js";
import { parseViewLocation, viewLocationHash, viewResourceKey } from "../src/planNavigation.js";
import { isViewAllowed, NAVIGATION_PAGE_OPTIONS } from "../src/accessPermissions.js";

test("진행상황은 업무 바로 아래에 위치하고 업무 권한·캐시를 재사용한다", () => {
  assert.equal(NAVIGATION_PAGE_OPTIONS[NAVIGATION_PAGE_OPTIONS.findIndex(page => page.id === "tasks") + 1].id, "progress");
  assert.equal(NAVIGATION_PAGE_OPTIONS.find(page => page.id === "progress").label, "진행상황");
  assert.deepEqual(parseViewLocation("#tasks/progress"), { view: "progress", planVariant: "client" });
  assert.equal(viewLocationHash("progress"), "tasks/progress");
  assert.equal(viewResourceKey("progress"), "tasks");
  assert.equal(isViewAllowed("progress", ["progress"]), true);
  assert.equal(isViewAllowed("progress", ["tasks"]), false);
  assert.equal(isViewAllowed("progress", ["overview"]), false);
});

test("이번 주는 한국시간 월요일부터 일요일까지이며 연도 경계를 처리한다", () => {
  assert.deepEqual(briefWeek(new Date("2026-09-06T15:01:00Z")), { today:"2026-09-07", start:"2026-09-07", end:"2026-09-13" });
  assert.deepEqual(briefWeek(new Date("2027-01-01T03:00:00Z")), { today:"2027-01-01", start:"2026-12-28", end:"2027-01-03" });
});

test("진행 업무와 이번 주 예정은 실제 상태·비연속 간트 날짜를 사용한다", () => {
  const data = progressBriefTasks([
    { id:1, statusCode:"DONE", updatedAt:"2026-09-02", plannedStartDate:"2026-09-01", dueDate:"2026-09-04" },
    { id:2, statusCode:"IN_PROGRESS", updatedAt:"2026-09-03", plannedStartDate:"2026-08-30", dueDate:"2026-09-04" },
    { id:3, statusCode:"NOT_STARTED", plannedStartDate:"2026-09-01", dueDate:"2026-09-04", scheduleDates:[] },
    { id:4, statusCode:"NOT_STARTED", plannedStartDate:"2026-08-25", dueDate:"2026-09-10", scheduleDates:["2026-08-25","2026-09-10"] },
    { id:5, statusCode:"NOT_STARTED", scheduleDates:["2026-09-06"] },
    { id:6, statusCode:"NOT_STARTED" },
  ], new Date("2026-09-03T00:00:00Z"));
  assert.deepEqual(data.progressed.map(row => row.id), [2,1]);
  assert.deepEqual(new Set(data.planned.map(row => row.id)), new Set([2,5]));
});

test("지난 회의는 미래 회의를 제외하고 고객에게 공개본만 보여준다", () => {
  const items = [
    { id:1,date:"2026-09-01",visibilityCode:"CLIENT" },
    { id:2,date:"2026-09-02",visibilityCode:"POCKET_ONLY" },
    { id:3,date:"2026-09-04",visibilityCode:"CLIENT" },
  ];
  assert.equal(latestBriefMeeting(items, {client:true,today:"2026-09-03"}).id, 1);
  assert.equal(latestBriefMeeting(items, {client:false,today:"2026-09-03"}).id, 2);
  assert.equal(latestBriefMeeting([], {client:true}), null);
});

test("완료 별칭과 검토 중 업무도 진행상황에서 누락하지 않는다", () => {
  const rows = ["COMPLETED","INTERNAL_REVIEW","WAITING_CLIENT","REVISION"].map(statusCode=>({id:statusCode,statusCode,plannedStartDate:"2026-09-01",dueDate:"2026-09-04"}));
  const result = progressBriefTasks(rows,new Date("2026-09-03T00:00:00Z"));
  assert.equal(result.progressed.length,4);
  assert.equal(result.planned.some(task=>task.statusCode==="COMPLETED"),false);
});

test("확인 요청은 남긴 사람을 포함해 저장하며 위험한 링크를 차단한다", () => {
  assert.equal(publicHttpLink("javascript:alert(1)"), null);
  assert.equal(publicHttpLink("file:///secret"), null);
  const fields = briefRequestFields({kind:"내용 확인", title:" 요청 ", body:" 설명 ", owner:"UND", requester:" 작성자 ", link:"https://example.com/item"});
  assert.deepEqual(fields, { kind_text:"내용 확인", related_task_text:"요청", body_text:"설명", owner_text:"UND", requester_text:"작성자", completion_url:"https://example.com/item", status_code:"IN_PROGRESS", due_date:null });
  assert.throws(() => briefRequestFields({title:"",body:"abc"}));
  assert.throws(() => briefRequestFields({title:"a",body:"b",link:"data:text/html,hi"}));
});

test("답변은 기존 기록을 보존하고 원장 제한을 넘기지 않는다", () => {
  const fields = appendBriefReply({remarks:"기존 메모"}, "추가 답변", "담당자", new Date("2026-09-03T01:00:00Z"));
  assert.ok(fields.remarks.startsWith("기존 메모\n\n["));
  assert.ok(fields.remarks.includes("담당자"));
  assert.ok(fields.remarks.endsWith("추가 답변"));
  assert.throws(() => appendBriefReply({remarks:"x".repeat(10000)}, "new", "담당자"));
});

test("컨펌 마감일은 선택 입력·해제·한국시간 기한 상태를 지원한다", () => {
  assert.deepEqual(requestDeadlineFields(""), {due_date:null});
  assert.deepEqual(requestDeadlineFields("2026-09-08"), {due_date:"2026-09-08"});
  for (const date of ["2026-02-30","2026-13-01","bad"]) assert.throws(()=>requestDeadlineFields(date));
  assert.equal(requestDeadlineLabel({dueDate:"2026-09-04"},"2026-09-04"),"오늘 마감 · 2026-09-04");
  assert.match(requestDeadlineLabel({dueDate:"2026-09-03"},"2026-09-04"),/기한 초과/);
  assert.doesNotMatch(requestDeadlineLabel({dueDate:"2026-09-03",statusCode:"DONE"},"2026-09-04"),/기한 초과/);
});

test("실서비스 진행상황은 시안 대신 실제 원장을 읽고 쓰기를 공통 잠금에 연결한다", async () => {
  const view = await readFile(new URL("../src/ProgressView.jsx", import.meta.url), "utf8");
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.ok(view.includes('source.dailyMeetings({ projectId: project.id'));
  assert.ok(view.includes('taskPage.issueCanWrite === true'));
  assert.ok(view.includes('!controller.signal.aborted'));
  assert.ok(view.includes('role === "client"'));
  assert.ok(view.includes('<IssueRequestCreateModal'));
  assert.ok(app.includes('key={project.id}'));
  assert.ok(app.includes('view === "progress") return source.tasks(params)'));
  assert.ok(!view.includes("dashboard-prototype"));
  assert.ok(app.includes('view === "progress") return <ProjectProgressView'));
  assert.ok(app.includes('displayMode="gantt" summaryOnly canWrite={false}'));
  assert.ok(app.includes('showOwners={props.role !== "client"}'));
  assert.ok(view.indexOf('className="pb-priority-grid"') < view.indexOf('className="pb-work-grid"'));
  assert.ok(view.indexOf('className="pb-work-grid"') < view.indexOf('className="pb-schedule"'));
  assert.ok(view.includes('className="pb-signal-strip"'));
  assert.ok(view.includes('className="pb-signal-progress"'));
  assert.ok(view.includes('role="progressbar"'));
  assert.ok(view.includes('<DeferredSchedule>{schedule}</DeferredSchedule>'));
  assert.ok(view.includes('title="최근 완료"'));
  assert.ok(view.includes('title="현재 진행"'));
  assert.ok(view.includes('title="이번 주 예정"'));
  assert.ok(view.includes('주요 이슈·확인 안건'));
  const navigation = app.slice(app.indexOf("const navigateToView ="), app.indexOf("const toggleNavigation ="));
  assert.ok(navigation.includes("setView(nextView)"));
  assert.ok(!navigation.includes("nextProject"));
});
