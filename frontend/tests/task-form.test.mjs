import assert from "node:assert/strict";
import test from "node:test";

let taskForm = {};
try {
  taskForm = await import("../src/taskForm.js");
} catch {}

test("업무 생성 폼은 로그인 조직을 기본 담당으로 사용한다", () => {
  assert.equal(typeof taskForm.taskCreateInitialFields, "function", "업무 생성 폼 모델이 필요합니다");
  assert.equal(taskForm.taskCreateInitialFields("pocket").workstream_code, "MARKETING");
  assert.equal(taskForm.taskCreateInitialFields("pocket").responsible_org_code, "POCKET");
  assert.equal(taskForm.taskCreateInitialFields("ns").responsible_org_code, "NS");
  assert.equal(taskForm.taskCreateInitialFields("client").responsible_org_code, "CLIENT");
});

test("업무 생성 분야는 Supabase 원장 표준 코드로 정규화한다", () => {
  assert.equal(taskForm.taskCreateSubmissionFields({title:"업무",workstream_code:"MKT"}).workstream_code, "MARKETING");
  assert.equal(taskForm.taskCreateSubmissionFields({title:"업무",workstream_code:"DSN"}).workstream_code, "DESIGN");
  assert.equal(taskForm.taskCreateSubmissionFields({title:"업무",workstream_code:"VID"}).workstream_code, "VIDEO");
  assert.match(taskForm.taskCreateValidationError({...taskForm.taskCreateInitialFields("pocket"),workstream_code:"UNKNOWN"}), /업무 분야/);
});

test("업무 생성 요청은 사용자가 고른 포켓 NS UND 담당을 덮어쓰지 않는다", () => {
  assert.equal(typeof taskForm.taskCreateSubmissionFields, "function", "업무 생성 요청 변환기가 필요합니다");
  for (const code of ["POCKET", "NS", "CLIENT"]) {
    const payload = taskForm.taskCreateSubmissionFields({
      title: "테스트 업무",
      responsible_org_code: code,
      due_date: "",
    });
    assert.equal(payload.responsible_org_code, code);
    assert.equal(payload.reviewer_org_code, "POCKET");
    assert.equal(Object.hasOwn(payload, "due_date"), false);
  }
});

test("업무 생성 담당 선택지는 프로젝트 고객사명을 사용한다", () => {
  assert.deepEqual(taskForm.taskResponsibleOrgOptions("무극"), [
    ["POCKET", "포켓"],
    ["NS", "NS"],
    ["CLIENT", "무극"],
  ]);
  assert.equal(taskForm.taskResponsibleOrgLabel("CLIENT", "UND"), "UND");
});

test("내부 업무 프레임은 프로젝트별 권한 캐시와 무관하게 동일하다", () => {
  assert.equal(taskForm.canOperateProjectTasks({ live: true, role: "pocket" }), true);
  assert.equal(taskForm.canOperateProjectTasks({ live: true, role: "ns" }), true);
  assert.equal(taskForm.canOperateProjectTasks({ live: true, role: "client" }), false);
  assert.equal(taskForm.canOperateProjectTasks({ live: false, role: "pocket" }), false);
});

test("완료 업무 추가는 완료 상태와 100%를 고정하고 담당 기본값은 로그인 조직을 따른다", () => {
  assert.equal(taskForm.taskCreateInitialFields("pocket", "completed").responsible_org_code, "POCKET");
  assert.equal(taskForm.taskCreateInitialFields("ns", "completed").responsible_org_code, "NS");
  assert.equal(taskForm.taskCreateInitialFields("client", "completed").responsible_org_code, "CLIENT");
  assert.equal(taskForm.taskCreateInitialFields("pocket", "completed").status_code, "DONE");
  assert.equal(taskForm.taskCreateInitialFields("pocket", "completed").progress_percent, 100);
});

test("새 업무는 오늘부터 7일, 완료 업무는 최근 7일을 제안한다", () => {
  const regular = taskForm.taskCreateInitialFields("ns", "default", "2026-09-03");
  assert.equal(regular.planned_start_date, "2026-09-03");
  assert.equal(regular.due_date, "2026-09-09");
  assert.equal(taskForm.taskDateRangeDuration(regular), 7);
  const done = taskForm.taskCreateInitialFields("pocket", "completed", "2026-09-03");
  assert.equal(done.planned_start_date, "2026-08-28");
  assert.equal(done.due_date, "2026-09-03");
  assert.equal(taskForm.taskDateRangeDuration(done), 7);
});

test("일정 빠른 선택은 한국 기준일과 월·연도 경계를 유지한다", () => {
  assert.deepEqual(taskForm.taskDateRangePreset("NEXT_7", new Date("2026-09-02T16:00:00Z")), {planned_start_date:"2026-09-03",due_date:"2026-09-09"});
  assert.deepEqual(taskForm.taskDateRangePreset("NEXT_7", "2026-12-29"), {planned_start_date:"2026-12-29",due_date:"2027-01-04"});
  assert.deepEqual(taskForm.taskDateRangePreset("LAST_7", "2024-03-03"), {planned_start_date:"2024-02-26",due_date:"2024-03-03"});
  assert.deepEqual(taskForm.taskDateRangePreset("THIS_WEEK", "2026-09-06"), {planned_start_date:"2026-08-31",due_date:"2026-09-06"});
  assert.deepEqual(taskForm.taskDateRangePreset("NEXT_WEEK", "2026-09-03"), {planned_start_date:"2026-09-07",due_date:"2026-09-13"});
  assert.deepEqual(taskForm.taskDateRangePreset("UNSCHEDULED"), {planned_start_date:"",due_date:""});
});

test("작성 오류는 저장 전에 안내하며 일정 미정은 허용한다", () => {
  const valid = {...taskForm.taskCreateInitialFields("pocket", "default", "2026-09-03"),title:"업무"};
  assert.equal(taskForm.taskCreateValidationError(valid), "");
  assert.equal(taskForm.taskCreateValidationError({...valid,title:"   "}), "");
  assert.match(taskForm.taskCreateValidationError({...valid,due_date:"2026-09-01"}), /종료일/);
  assert.match(taskForm.taskCreateValidationError({...valid,due_date:""}), /함께/);
  assert.equal(taskForm.taskCreateValidationError({...valid,progress_percent:101}), "");
  assert.match(taskForm.taskCreateValidationError({...valid,completion_url:"javascript:alert(1)"}), /https/);
  assert.equal(taskForm.taskCreateValidationError({...valid,...taskForm.taskDateRangePreset("UNSCHEDULED")}), "");
});

test("업무명은 선택 입력이며 비우면 식별 가능한 기본 제목으로 저장한다", () => {
  const fields = taskForm.taskCreateInitialFields("ns", "default", "2026-09-04");
  assert.equal(taskForm.taskCreateValidationError(fields), "");
  assert.equal(taskForm.taskCreateSubmissionFields(fields).title, "제목 없는 업무");
  assert.equal(taskForm.taskCreateSubmissionFields({...fields,title:"  직접 입력한 업무  "}).title, "직접 입력한 업무");
});

test("새 업무 일정은 간트 배열에 일치시키고 완료 진행률은 100으로 저장한다", () => {
  const fields = {...taskForm.taskCreateInitialFields("ns","completed","2026-09-03"),title:"  완료 업무  ",progress_percent:0};
  const payload = taskForm.taskCreateSubmissionFields(fields);
  assert.equal(payload.title, "완료 업무");
  assert.equal(payload.progress_percent, 100);
  const dates = JSON.parse(payload.schedule_dates_json);
  assert.equal(dates.length, 7);
  assert.equal(dates[0], fields.planned_start_date);
  assert.equal(dates.at(-1), fields.due_date);
  const unscheduled = taskForm.taskCreateSubmissionFields({...fields,...taskForm.taskDateRangePreset("UNSCHEDULED")});
  assert.equal(Object.hasOwn(unscheduled, "schedule_dates_json"), false);
});

test("업무 생성은 표·일정 필드를 보존하고 진행률을 숫자로 변환한다", () => {
  const payload = taskForm.taskCreateSubmissionFields({
    title: "업무",
    description: "세부내용",
    planned_start_date: "2026-09-01",
    due_date: "2026-09-03",
    progress_percent: "25",
    completion_url: "https://example.com/result",
    remarks: "비고",
  });
  assert.equal(payload.progress_percent, undefined);
  assert.equal(payload.completion_url, "https://example.com/result");
  assert.equal(payload.remarks, "비고");
});

test("일정표 수정 폼은 업무 원장의 현재 값을 그대로 연다", () => {
  const fields = taskForm.taskUpdateInitialFields({
    title: "콘텐츠 제작",
    statusCode: "COMPLETED",
    description: "상세",
    plannedStartDate: "2026-09-02",
    dueDate: "2026-09-05",
    progressPercent: 80,
    responsibleOrgCode: "NS",
  });
  assert.equal(fields.status_code, "DONE");
  assert.equal(fields.planned_start_date, "2026-09-02");
  assert.equal(fields.due_date, "2026-09-05");
  assert.equal(fields.progress_percent, 80);
  assert.equal(fields.responsible_org_code, "NS");
});

test("일정표 수정 요청은 목록 수정과 같은 업무 필드를 숫자·코드로 정규화한다", () => {
  const fields = taskForm.taskUpdateSubmissionFields({
    title: "  콘텐츠 제작  ",
    status_code: "on_hold",
    planned_start_date: "2026-09-02",
    due_date: "2026-09-05",
    progress_percent: "35",
    priority_code: "high",
    responsible_org_code: "ns",
  });
  assert.equal(fields.title, "콘텐츠 제작");
  assert.equal(fields.status_code, "ON_HOLD");
  assert.equal(fields.progress_percent, undefined);
  assert.equal(fields.priority_code, "HIGH");
  assert.equal(fields.responsible_org_code, "NS");
  assert.equal(fields.schedule_dates_json, JSON.stringify([
    "2026-09-02",
    "2026-09-03",
    "2026-09-04",
    "2026-09-05",
  ]));
});

test("일정표 날짜 수정은 간트 일정 배열도 함께 갱신한다", () => {
  const withoutCompleteRange = taskForm.taskUpdateSubmissionFields({
    title: "날짜 미정 업무",
    planned_start_date: "2026-09-02",
    due_date: "",
  });
  assert.equal(withoutCompleteRange.schedule_dates_json, null);
});

test("일정표 상태와 담당 클릭은 제품에서 정한 순서로 순환한다", () => {
  assert.equal(taskForm.nextTaskStatusCode("NOT_STARTED"), "IN_PROGRESS");
  assert.equal(taskForm.nextTaskStatusCode("IN_PROGRESS"), "DELAYED");
  assert.equal(taskForm.nextTaskStatusCode("COMPLETED"), "ON_HOLD");
  assert.equal(taskForm.nextTaskStatusCode("BLOCKED"), "NOT_STARTED");
  assert.equal(taskForm.nextTaskResponsibleOrgCode("POCKET"), "NS");
  assert.equal(taskForm.nextTaskResponsibleOrgCode("NS"), "CLIENT");
  assert.equal(taskForm.nextTaskResponsibleOrgCode("CLIENT"), "POCKET");
});

test("일정표에서 완료로 바꾸면 상태와 진행률 100을 한 번에 저장한다", () => {
  assert.deepEqual(taskForm.taskStatusMutationFields("DONE"), {
    status_code: "DONE",
    progress_percent: 100,
  });
  assert.deepEqual(taskForm.taskStatusMutationFields("ON_HOLD"), {
    status_code: "ON_HOLD",
  });
  assert.deepEqual(taskForm.taskStatusMutationFields("IN_PROGRESS", {statusCode:"DONE",progressPercent:100}), {status_code:"IN_PROGRESS",progress_percent:0});
  assert.deepEqual(taskForm.taskStatusMutationFields("NOT_STARTED", {statusCode:"IN_PROGRESS",progressPercent:40}), {status_code:"NOT_STARTED",progress_percent:0});
  assert.deepEqual(taskForm.taskStatusMutationFields("ON_HOLD", {statusCode:"IN_PROGRESS",progressPercent:40}), {status_code:"ON_HOLD"});
});
