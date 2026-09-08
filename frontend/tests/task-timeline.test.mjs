import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { tasksViewModel } from "../src/api/viewModel.js";

import { buildTaskTimeline, filterTaskSchedule, groupTaskScheduleByMedia, groupTaskScheduleSeries, reorderTaskSchedule, selectTaskRange, sortTaskSchedule, taskHiddenFromClient, taskScheduleCategory, taskScheduleMedia, taskScheduleMediaCode, taskScheduleSeries, taskScheduleStatusGroup, toggleScheduleStatusFilter, withDisplayDeadline } from "../src/taskTimeline.js";

test("신규 DB 업무분야와 구형 코드는 한글로 표시하고 같은 필터에 포함한다", () => {
  const codes = ["MARKETING", "DESIGN", "VIDEO", "MKT", "DSN", "VID"];
  const rows = tasksViewModel({data:{items:codes.map((code, index) => ({task_id:String(index),workstream_code:code}))}}).items;
  assert.deepEqual(rows.map(row => row.stream), ["마케팅","디자인","영상","마케팅","디자인","영상"]);
  assert.deepEqual(rows.map(taskScheduleCategory), ["마케팅","디자인","영상","마케팅","디자인","영상"]);
  assert.equal(taskScheduleCategory({streamCode:"VIDEO",stream:"VIDEO"}), "영상");
  assert.equal(taskScheduleCategory({stream:"UNKNOWN"}), "미분류");
  assert.equal(filterTaskSchedule(rows,{category:"마케팅"}).length,2);
});

test("상태·분야·매체·기간·담당 회사 필터는 생성자와 무관하게 교집합으로 적용한다", () => {
  const tasks = [
    {id:"A",streamCode:"MARKETING",categoryCode:"YOUTUBE",statusCode:"IN_PROGRESS",responsibleOrgCode:"NS",createdByOrgCode:"POCKET",scheduleDates:["2026-09-03"]},
    {id:"B",streamCode:"MARKETING",categoryCode:"YOUTUBE",statusCode:"IN_PROGRESS",responsibleOrgCode:"POCKET",createdByOrgCode:"NS",scheduleDates:["2026-09-03"]},
    {id:"C",streamCode:"DESIGN",categoryCode:"INSTAGRAM",statusCode:"NOT_STARTED",responsibleOrgCode:"NS",scheduleDates:["2026-09-09"]},
  ];
  const filter={status:"ACTIVE",category:"마케팅",media:"YouTube",schedule:"THIS_WEEK",owner:"NS"};
  assert.deepEqual(filterTaskSchedule(tasks,filter,"2026-09-03").map(t=>t.id),["A"]);
  assert.deepEqual(filterTaskSchedule(tasks,{...filter,owner:"POCKET"},"2026-09-03").map(t=>t.id),["B"]);
  assert.deepEqual(filterTaskSchedule(tasks,{...filter,media:"Instagram"},"2026-09-03"),[]);
  assert.deepEqual(filterTaskSchedule(tasks,{status:"TODO"}).map(t=>t.id),["C"]);
  assert.equal(filterTaskSchedule(tasks,{}).length,3);
});

test("오늘·이번달 필터는 실제 선택 날짜만 보고 비운 간트와 미등록 일정을 제외한다", () => {
  const tasks=[{id:"A",scheduleDates:["2026-08-31","2026-09-03"]},{id:"B",scheduleDates:["2026-09-30"]},{id:"C",scheduleDates:["2026-10-01"]},{id:"D",scheduleDates:[]}];
  assert.deepEqual(filterTaskSchedule(tasks,{schedule:"TODAY"},"2026-09-03").map(t=>t.id),["A"]);
  assert.deepEqual(filterTaskSchedule(tasks,{schedule:"THIS_MONTH"},"2026-09-03").map(t=>t.id),["A","B"]);
});

test("업무 시작일과 종료일을 같은 축의 간트 위치로 변환한다", () => {
  const timeline = buildTaskTimeline([
    { id: "A", plannedStartDate: "2026-08-10", dueDate: "2026-08-20" },
    { id: "B", plannedStartDate: "2026-08-20", dueDate: "2026-09-09" },
  ], { startDate: "2026-08-10", endDate: "2026-09-09" }, "2026-08-31");
  assert.equal(timeline.start, "2026-08-10");
  assert.equal(timeline.end, "2026-09-09");
  assert.equal(timeline.dayCount, 31);
  assert.equal(timeline.rows.length, 2);
  assert.ok(timeline.rows[1].left > timeline.rows[0].left);
  assert.ok(timeline.todayLeft > 0 && timeline.todayLeft < 100);
});

test("일정표 끝은 프로젝트 종료일이 아니라 가장 늦은 업무 종료일까지만 잡는다", () => {
  const timeline = buildTaskTimeline([
    { id: "A", plannedStartDate: "2026-09-01", dueDate: "2026-09-05" },
    { id: "B", plannedStartDate: "2026-09-03", dueDate: "2026-09-12" },
  ], { startDate: "2026-09-01", endDate: "2026-12-31" });
  assert.equal(timeline.start, "2026-09-01");
  assert.equal(timeline.end, "2026-09-12");
  assert.equal(timeline.dayCount, 12);
});

test("업무가 있으면 프로젝트 착수일보다 실제 첫 업무일에서 간트가 시작한다", () => {
  const timeline = buildTaskTimeline([
    { id: "A", plannedStartDate: "2026-09-01", dueDate: "2026-09-05" },
  ], { startDate: "2026-08-24", endDate: "2026-12-14" });
  assert.equal(timeline.start, "2026-09-01");
  assert.equal(timeline.end, "2026-09-05");
});

test("등록된 업무 일정이 없을 때만 프로젝트 기간을 예비 축으로 사용한다", () => {
  const timeline = buildTaskTimeline([], { startDate: "2026-09-01", endDate: "2026-09-30" });
  assert.equal(timeline.start, "2026-09-01");
  assert.equal(timeline.end, "2026-09-30");
});

test("날짜가 없는 업무는 일정 축에서 제외한다", () => {
  const timeline = buildTaskTimeline([{ id: "A" }], {});
  assert.equal(timeline.rows.length, 0);
  assert.equal(timeline.dayCount, 0);
});

test("계산된 마감 표시는 실제 사용자 입력 종료일을 덮어쓰지 않는다", () => {
  const task = { id: "A", dueDate: null, due: "미정" };
  const decorated = withDisplayDeadline(task, "09.09 · D-8");
  assert.equal(decorated.due, "09.09 · D-8");
  assert.equal(decorated.dueDate, null);
});

test("일정표 업무를 상태와 카테고리로 함께 필터링한다", () => {
  const tasks = [
    { id: "A", statusCode: "IN_PROGRESS", stream: "마케팅", plannedStartDate: "2026-08-20", dueDate: "2026-09-05" },
    { id: "B", statusCode: "DONE", stream: "디자인", plannedStartDate: "2026-08-10", dueDate: "2026-08-20" },
    { id: "C", statusCode: "ON_HOLD", stream: "영상", plannedStartDate: "2026-08-20", dueDate: "2026-09-05" },
  ];
  assert.equal(taskScheduleCategory(tasks[0]), "마케팅");
  assert.equal(taskScheduleStatusGroup(tasks[0]), "ACTIVE");
  assert.equal(taskScheduleStatusGroup(tasks[1]), "DONE");
  assert.equal(taskScheduleStatusGroup(tasks[2]), "HOLD");
  assert.deepEqual(filterTaskSchedule(tasks, { status: "ACTIVE", category: "마케팅" }, "2026-09-01").map((task) => task.id), ["A"]);
});

test("간트 그룹은 업무 분야와 분리해 원본 매체 이름을 사용한다", () => {
  assert.equal(taskScheduleMedia({ categoryCode: "YOUTUBE", stream: "마케팅" }), "YouTube");
  assert.equal(taskScheduleMedia({ categoryCode: "NAVER_BLOG", stream: "디자인" }), "네이버블로그");
});

test("일정 구간은 월요일부터 일요일까지 지난주·이번주·다음주로 구분한다", () => {
  const tasks = [
    { id: "LAST", statusCode: "DONE", plannedStartDate: "2026-08-24", dueDate: "2026-08-30" },
    { id: "THIS", statusCode: "IN_PROGRESS", plannedStartDate: "2026-08-31", dueDate: "2026-09-06" },
    { id: "NEXT", statusCode: "NOT_STARTED", plannedStartDate: "2026-09-07", dueDate: "2026-09-13" },
    { id: "UNSCHEDULED", statusCode: "NOT_STARTED" },
  ];
  assert.deepEqual(filterTaskSchedule(tasks, { schedule: "LAST_WEEK" }, "2026-09-01").map((task) => task.id), ["LAST"]);
  assert.deepEqual(filterTaskSchedule(tasks, { schedule: "THIS_WEEK" }, "2026-09-01").map((task) => task.id), ["THIS"]);
  assert.deepEqual(filterTaskSchedule(tasks, { schedule: "NEXT_WEEK" }, "2026-09-01").map((task) => task.id), ["NEXT"]);
  assert.deepEqual(filterTaskSchedule(tasks, { schedule: "THIS_WEEK" }, new Date(2026, 8, 1, 9, 30)).map((task) => task.id), ["THIS"]);
});

test("비연속 간트 일정은 시작일과 종료일 사이의 빈 주를 일정으로 오인하지 않는다", () => {
  const tasks = [{
    id: "HOLE",
    plannedStartDate: "2026-08-30",
    dueDate: "2026-09-07",
    scheduleDates: ["2026-08-30", "2026-09-07"],
  }];
  assert.deepEqual(filterTaskSchedule(tasks, { schedule: "THIS_WEEK" }, "2026-09-01"), []);
  assert.deepEqual(filterTaskSchedule(tasks, { schedule: "NEXT_WEEK" }, "2026-09-01").map((task) => task.id), ["HOLE"]);
});

test("일정표는 시작일과 종료일이 빠른 업무를 먼저 두고 미등록 업무를 마지막에 둔다", () => {
  const tasks = [
    { id: "NONE", title: "일정 없음" },
    { id: "LATE", title: "후순위", plannedStartDate: "2026-09-10", dueDate: "2026-09-12" },
    { id: "EARLY-B", title: "선순위 B", plannedStartDate: "2026-09-01", dueDate: "2026-09-05" },
    { id: "EARLY-A", title: "선순위 A", plannedStartDate: "2026-09-01", dueDate: "2026-09-03" },
  ];
  assert.deepEqual(sortTaskSchedule(tasks).map((task) => task.id), ["EARLY-A", "EARLY-B", "LATE", "NONE"]);
});

test("일정표와 간트는 원장 순서를 보존하면서 같은 매체를 연속 그룹으로 묶는다", () => {
  const tasks = [
    { id: "YT-1", categoryCode: "YOUTUBE" },
    { id: "ADS-1", categoryCode: "ADS" },
    { id: "YT-2", categoryCode: "YOUTUBE" },
    { id: "NAVER-1", categoryCode: "NAVER_BLOG" },
    { id: "ADS-2", categoryCode: "ADS" },
  ];
  assert.deepEqual(groupTaskScheduleByMedia(tasks).map((task) => task.id), ["YT-1", "YT-2", "ADS-1", "ADS-2", "NAVER-1"]);
});

test("유튜브 패키지 순서는 저장된 sort_order를 따라 드래그 재정렬을 보존한다", () => {
  const tasks = [
    { id: "SHORT-1", title: "쇼츠 업로드 SEO 1/2", categoryCode: "YOUTUBE", sortOrder: 60 },
    { id: "MAIN-2", title: "본편 업로드 SEO 2/2", categoryCode: "YOUTUBE", sortOrder: 40 },
    { id: "VIEW-1", title: "영상 조회수 작업 1/2", categoryCode: "YOUTUBE", sortOrder: 20 },
    { id: "MAIN-1", title: "본편 업로드 SEO 1/2", categoryCode: "YOUTUBE", sortOrder: 10 },
    { id: "LIKE-1", title: "영상 좋아요 작업 1/2", categoryCode: "YOUTUBE", sortOrder: 30 },
    { id: "VIEW-2", title: "영상 조회수 작업 2/2", categoryCode: "YOUTUBE", sortOrder: 50 },
    { id: "SHORT-2", title: "쇼츠 업로드 SEO 2/2", categoryCode: "YOUTUBE", sortOrder: 70 },
  ];
  assert.deepEqual(groupTaskScheduleByMedia(tasks).map((task) => task.id), ["MAIN-1", "VIEW-1", "LIKE-1", "MAIN-2", "VIEW-2", "SHORT-1", "SHORT-2"]);
});

test("같은 매체·분야·업무명의 번호 회차만 하나의 펼침 묶음으로 만든다", () => {
  const tasks = [
    { id: "IG-1", title: "콘텐츠 제작 / 업로드 1/10", categoryCode: "INSTAGRAM", streamCode: "DESIGN" },
    { id: "IG-2", title: "콘텐츠 제작 / 업로드 2/10", categoryCode: "INSTAGRAM", streamCode: "DESIGN" },
    { id: "IG-OTHER", title: "계정 설정", categoryCode: "INSTAGRAM", streamCode: "MARKETING" },
    { id: "YT-1", title: "콘텐츠 제작 / 업로드 1/10", categoryCode: "YOUTUBE", streamCode: "DESIGN" },
  ];
  assert.deepEqual(taskScheduleSeries(tasks[0]), {
    key: "INSTAGRAM::디자인::콘텐츠 제작 / 업로드::10",
    baseTitle: "콘텐츠 제작 / 업로드",
    item: 1,
    total: 10,
  });
  const rows = groupTaskScheduleSeries(tasks);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].type, "series");
  assert.equal(rows[0].baseTitle, "콘텐츠 제작 / 업로드");
  assert.deepEqual(rows[0].tasks.map((task) => task.id), ["IG-1", "IG-2"]);
  assert.equal(rows[1].type, "task");
  assert.equal(rows[2].type, "task");
});

test("필터로 같은 회차가 하나만 남으면 불필요한 묶음 행을 만들지 않는다", () => {
  const rows = groupTaskScheduleSeries([
    { id: "ONE", title: "포스팅 2/5", categoryCode: "NAVER_BLOG", streamCode: "MARKETING" },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, "task");
});

test("개별 업무와 접힌 회차 묶음을 대상 업무 앞으로 이동한다", () => {
  const tasks = [
    { id: "A", title: "일반 A", categoryCode: "INSTAGRAM", streamCode: "DESIGN" },
    { id: "S1", title: "콘텐츠 업로드 1/3", categoryCode: "INSTAGRAM", streamCode: "DESIGN" },
    { id: "S2", title: "콘텐츠 업로드 2/3", categoryCode: "INSTAGRAM", streamCode: "DESIGN" },
    { id: "B", title: "일반 B", categoryCode: "INSTAGRAM", streamCode: "DESIGN" },
  ];
  assert.deepEqual(reorderTaskSchedule(tasks, "B", "A").map((task) => task.id), ["B", "A", "S1", "S2"]);
  const seriesKey = groupTaskScheduleSeries(tasks).find((entry) => entry.type === "series").key;
  assert.deepEqual(reorderTaskSchedule(tasks, seriesKey, "A").map((task) => task.id), ["S1", "S2", "A", "B"]);
  assert.deepEqual(reorderTaskSchedule(tasks, seriesKey, "S2").map((task) => task.id), ["A", "S1", "S2", "B"]);
});

test("체크한 여러 업무는 기존 상대 순서를 유지해 대상 앞뒤로 함께 이동한다", () => {
  const tasks = ["A", "B", "C", "D", "E"].map((id) => ({ id }));
  assert.deepEqual(reorderTaskSchedule(tasks, ["B", "D"], "A", "before").map((task) => task.id), ["B", "D", "A", "C", "E"]);
  assert.deepEqual(reorderTaskSchedule(tasks, ["B", "D"], "E", "after").map((task) => task.id), ["A", "C", "E", "B", "D"]);
  assert.deepEqual(reorderTaskSchedule(tasks, ["B", "D"], "D", "after").map((task) => task.id), ["A", "B", "C", "D", "E"]);
});

test("Shift 체크는 현재 보이는 업무 범위만 한 번에 선택하거나 해제한다", () => {
  const tasks = ["A", "B", "C", "D"].map((id) => ({ id }));
  assert.deepEqual([...selectTaskRange(tasks, new Set(["OUTSIDE"]), "A", "C", true)], ["OUTSIDE", "A", "B", "C"]);
  assert.deepEqual([...selectTaskRange(tasks, new Set(["A", "B", "C", "D"]), "B", "D", false)], ["A"]);
});

test("드롭 대상 매체 코드는 화면 라벨 또는 원장 코드에서 동일하게 계산한다", () => {
  assert.equal(taskScheduleMediaCode({ categoryCode: "youtube" }), "YOUTUBE");
  assert.equal(taskScheduleMediaCode({ category: "네이버블로그" }), "NAVER_BLOG");
});

test("일정표 상단 상태 요약은 같은 상태를 다시 누르면 전체로 돌아간다", () => {
  assert.equal(toggleScheduleStatusFilter("ALL", "DONE"), "DONE");
  assert.equal(toggleScheduleStatusFilter("DONE", "DONE"), "ALL");
  assert.equal(toggleScheduleStatusFilter("DONE", "ACTIVE"), "ACTIVE");
});

test("고객 공개 업무만 고객사 표시 대상으로 판정한다", () => {
  assert.equal(taskHiddenFromClient({ visibilityCode: "CLIENT" }), false);
  assert.equal(taskHiddenFromClient({ visibilityCode: "PROJECT_TEAM" }), true);
  assert.equal(taskHiddenFromClient({ visibility_code: "POCKET_ONLY" }), true);
  assert.equal(taskHiddenFromClient({}), true);
});

test("간트는 날짜별 선택 셀과 연속 구간 모서리를 표시한다", () => {
  const appSource = fs.readFileSync(new URL("../src/TaskWorkspace.jsx", import.meta.url), "utf8");
  const styles = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(appSource, /className="gantt reference-gantt"/);
  assert.match(appSource, /starts \? " rs"/);
  assert.match(appSource, /ends \? " re"/);
  assert.doesNotMatch(appSource, /g-c task-schedule-cell/);
  assert.match(appSource, /className="g-rail-dot"/);
  assert.match(appSource, /<div className="g-months">/);
  assert.match(appSource, /taskResponsibleOrgLabel\(task\.responsibleOrgCode, project\.clientName\)/);
  assert.match(appSource, /className="task-inline-date"/);
  assert.match(styles, /\.g-row/);
  assert.match(styles, /\.g-d\.ref/);
  assert.match(styles, /\.g-c\.on\.rs::before/);
  assert.doesNotMatch(appSource, /<select value=\{statusFilter\}/);
  assert.match(appSource, /scheduleWeekFilters/);
});
