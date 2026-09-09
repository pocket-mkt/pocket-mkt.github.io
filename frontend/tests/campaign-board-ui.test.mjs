import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = (await Promise.all(["App.jsx", "TaskWorkspace.jsx"].map(file => readFile(new URL(`../src/${file}`, import.meta.url), "utf8")))).join("\n");
const permissionsSource = await readFile(new URL("../src/PermissionsView.jsx", import.meta.url), "utf8");
const quoteSource = await readFile(new URL("../src/QuoteImportModal.jsx", import.meta.url), "utf8");
const styleSource = (await Promise.all(["styles.css", "permissionsView.css"].map(file => readFile(new URL(`../src/${file}`, import.meta.url), "utf8")))).join("\n");

test("필터는 탭 없이 모두 표시하고 간트는 업무별 상태를 문자와 색상으로 표시한다", () => {
  const filters = appSource.slice(appSource.indexOf("function TaskScheduleFilters("), appSource.indexOf("function TaskWorkspaceTabs("));
  assert.ok(filters.includes('className="schedule-filter-rows"'));
  assert.ok(filters.includes('groups.map(group =>'));
  assert.ok(!filters.includes('role="tab"'));
  assert.ok(!filters.includes("activeId"));
  assert.ok(appSource.includes("g-task-status is-"));
  assert.ok(appSource.includes('ACTIVE: "진행중", HOLD: "보류", DONE: "완료", TODO: "미착수"'));
  for (const group of ["active","hold","done"]) assert.ok(styleSource.includes(".g-task-status.is-"+group));
});

test("업무 화면은 중복 운영 보드 없이 일정표·간트·업무 로그로 구성한다", () => {
  assert.match(appSource, /initialSection = "schedule"/);
  assert.match(appSource, /function TaskWorkspaceTabs/);
  assert.match(appSource, /activityMode \? <TaskActivityLog/);
  assert.match(appSource, /onViewChange=\{selectTaskView\}/);
  assert.doesNotMatch(appSource, />운영 보드<\/button>/);
  assert.doesNotMatch(appSource, /onSectionChange\?\.\("list"\)/);
  assert.match(appSource, /initialSection="schedule"/);
});

test("일정표와 간트는 같은 원장 행을 두 가지 표시 방식으로 전환한다", () => {
  assert.match(appSource, /const \[displayMode, setDisplayMode\] = useState\(initialSection === "activity" \? "activity" : "table"\)/);
  assert.match(appSource, /aria-selected=\{activeView === "table"\}/);
  assert.match(appSource, /aria-selected=\{activeView === "gantt"\}/);
  assert.match(appSource, /task-schedule-matrix is-detailed reference-task-table/);
  assert.match(appSource, /className="gantt reference-gantt"/);
  assert.match(appSource, /className="g-hrow"/);
  assert.match(appSource, /className="g-grow"/);
  assert.match(appSource, /className="task-workspace-tab-check"/);
  assert.match(styleSource, /\.campaign-schedule-board \.reference-toolbar \.task-workspace-tabs button\[aria-selected="true"\][\s\S]*background:\s*#071a44/);
});

test("간트 프레임은 제공된 캠페인 HTML의 toolbar·panel·scroll 계층을 유지한다", () => {
  assert.match(appSource, /className="campaign-schedule-toolbar reference-toolbar toolbar"/);
  assert.match(appSource, /className="campaign-schedule-table-heading panel-head reference-panel-head"/);
  assert.match(appSource, /className="reference-gantt-scroll scroll"/);
  assert.match(appSource, />매체 · 업무<\/span>/);
  assert.match(styleSource, /\.reference-schedule-panel[\s\S]*border-radius:\s*8px/);
  assert.match(styleSource, /\.reference-gantt-scroll[\s\S]*max-height:\s*calc\(100vh - 250px\)/);
});

test("간트는 사각형 드래그로 일정 추가와 삭제를 구분하고 원장 저장으로 연결한다", () => {
  assert.match(appSource, /paintGanttRectangle/);
  assert.match(appSource, /mode: active \? "erase" : "paint"/);
  assert.match(appSource, /schedule_dates_json: serializeScheduleDates\(dates\)/);
  assert.doesNotMatch(appSource, /\.\.\.taskUpdateSubmissionFields\(taskUpdateInitialFields\(row\.task\)\)/);
  assert.match(appSource, /await onBatchUpdate\(batch\)/);
  assert.match(appSource, /offset \+= 40/);
  assert.match(appSource, /window\.addEventListener\("pointermove"/);
  assert.match(styleSource, /\.g-c\.on::before/);
  assert.match(styleSource, /\.g-track\.paint \.g-c:hover::after/);
});

test("간트 드래그 행은 매체로 묶인 일정표와 실제 화면 순서가 동일하다", () => {
  assert.match(appSource, /groupTaskScheduleByMedia\(ganttVisibleTasks\)/);
  assert.match(appSource, /groupGanttTasks\(filteredTasks, taskScheduleMedia\)/);
  assert.match(appSource, /const ganttTasks = filteredTasks/);
  assert.match(appSource, /ganttTasksRef\.current = ganttTasks/);
  assert.match(appSource, /const rows = ganttTasksRef\.current\.map/);
  assert.match(appSource, /const rowIndex = ganttRowIndexById\.get\(task\.id\)/);
  assert.doesNotMatch(appSource, /filteredTasks\.findIndex\(\(item\) => item\.id === task\.id\)/);
});

test("번호 회차 업무도 일정표와 간트에서 접지 않고 개별 행으로 표시한다", () => {
  assert.doesNotMatch(appSource, /const displayRows = groupTaskScheduleSeries\(tasks\)/);
  assert.doesNotMatch(appSource, /ganttSeriesGroups/);
  assert.doesNotMatch(appSource, /expandedSeries/);
  assert.match(appSource, /tasks\.forEach\(\(task, index\) =>/);
  assert.match(appSource, /if \(row\.task\) return renderGanttTaskRow\(row\.task/);
});

test("참고 캠페인 일정 화면이 업무 화면의 최상위 구조이며 로그는 툴바에서 연다", () => {
  assert.match(appSource, /className="campaign-schedule-board"/);
  assert.match(appSource, /className="campaign-board-progress"/);
  assert.match(appSource, /onClick=\{\(\) => onChange\("activity"\)\}/);
  assert.match(appSource, /<TaskScheduleInlineTable tasks=\{filteredTasks\}/);
});

test("일정표는 참고 HTML 열 구조를 유지하며 셀 직접 수정과 상태·담당 선택 저장을 제공한다", () => {
  assert.match(appSource, /<th>매체<\/th><th>업무분야<\/th><th>업무<\/th><th>세부내용<\/th><th>일정<\/th><th>기간<\/th><th>진행률<\/th><th>상태<\/th><th>담당<\/th><th>완료링크<\/th><th>비고<\/th>/);
  assert.match(appSource, /function TaskScheduleInlineRow/);
  assert.match(appSource, /onBlur=\{\(event\) => void commitField\("description"/);
  assert.match(appSource, /onBlur=\{\(event\) => void commitField\("completion_url"/);
  assert.match(appSource, /className=\{`task-inline-select task-inline-status/);
  assert.match(appSource, /className=\{`task-inline-select task-inline-owner/);
  assert.match(appSource, /onChange=\{\(event\) => \{ const next = event\.target\.value; setField\("status_code", next\); void commitField\("status_code", next\); \}\}/);
  assert.match(appSource, /onChange=\{\(event\) => \{ const next = event\.target\.value; setField\("responsible_org_code", next\); void commitField\("responsible_org_code", next\); \}\}/);
  assert.match(appSource, /schedule_dates_json: start && end \? serializeScheduleDates\(scheduleDateRange\(start, end\)\) : null/);
  assert.match(styleSource, /\.campaign-schedule-surface \.reference-task-table[\s\S]*width:\s*100%/);
  assert.match(styleSource, /min-width:\s*var\(--schedule-min-width, 1308px\)/);
  assert.match(styleSource, /\.campaign-schedule-surface \.reference-task-table[\s\S]*table-layout:\s*fixed/);
  assert.match(styleSource, /\.reference-task-cell\s*\{[\s\S]*min-height:\s*32px/);
  assert.match(appSource, /className="reference-task-media"[\s\S]*<span><i aria-hidden="true" \/>\{media\}<\/span>/);
  assert.match(appSource, /className="reference-task-cell task-inline-date-range"[\s\S]*commitField\("date_range"\)/);
  assert.match(appSource, /function CompactTaskDateInput/);
  assert.match(appSource, /const columnWidths = \[88, 64, null, 200, 126, 44, 92, 78, 78, 105, 135\]/);
  assert.match(appSource, /reference-task-workstream[\s\S]*taskScheduleCategory\(task\)/);
  assert.match(appSource, /fields = taskStatusMutationFields\(value, baseTask\)/);
  assert.match(styleSource, /\.reference-task-detail \.task-inline-textarea[\s\S]*field-sizing:\s*content/);
  assert.match(styleSource, /\.reference-task-detail \.task-inline-textarea[\s\S]*max-height:\s*calc\(2 \* 1\.45em \+ 6px\)/);
  assert.match(styleSource, /tr\.is-media-group-start:not\(:first-child\) td/);
  assert.match(appSource, /aria-label="표시된 업무 전체 선택"/);
  assert.match(appSource, /className="task-reorder-handle"/);
  assert.match(appSource, /<th>비고<\/th>\{canWrite && <th>관리<\/th>\}/);
  assert.match(appSource, /function TaskRowActions/);
  assert.match(appSource, /onArchive=\{onTaskArchive\}/);
  assert.match(appSource, /operation: "ARCHIVE"/);
});

test("일정표와 간트는 체크 선택, 일괄 상태·담당 변경, 드래그 순서 이동을 공유한다", () => {
  assert.match(appSource, /className="task-bulk-toolbar"/);
  assert.match(appSource, /selectedTaskIds\.size/);
  assert.match(appSource, /await saveUpdateChunks\(updates\)/);
  assert.match(appSource, /const fields = \{ sort_order: \(index \+ 1\) \* 10 \}/);
  assert.match(appSource, /className="g-reorder-handle"/);
  assert.match(appSource, /select className=\{`g-task-status/);
  assert.match(appSource, /select className=\{`g-owner-select/);
  assert.match(styleSource, /\.task-bulk-toolbar/);
});

test("포켓은 선택한 업무를 고객사에서 일괄 숨기거나 다시 공개할 수 있다", () => {
  assert.match(appSource, /canManageVisibility=\{Boolean\(editable && role === "pocket"\)\}/);
  assert.match(appSource, /className="task-bulk-visibility"/);
  assert.match(appSource, /<option value="PROJECT_TEAM">숨김 · 내부만<\/option><option value="CLIENT">공개<\/option>/);
  assert.match(appSource, /bulkVisibility \? \{ visibility_code: bulkVisibility \} : \{\}/);
  assert.match(appSource, /next\.visibilityCode = String\(fields\.visibility_code/);
  assert.match(appSource, /className="task-client-hidden-badge"/);
  assert.match(appSource, /className="g-client-hidden-badge"/);
  assert.match(styleSource, /\.task-client-hidden-badge,/);
});

test("업무표와 간트는 다중 이동·Shift 범위 선택·일괄 소프트 삭제를 제공한다", () => {
  assert.match(appSource, /selectTaskRange\(filteredTasks, current, anchorTaskId, taskId, checked\)/);
  assert.match(appSource, /event\.nativeEvent\?\.shiftKey \|\| event\.shiftKey/);
  assert.match(appSource, /selectedTaskIds\.has\(taskId\)[\s\S]*filteredTasks\.filter/);
  assert.match(appSource, /reorderTaskSchedule\(filteredTasks, sourceIds, targetTaskId, position\)/);
  assert.match(appSource, /fields\.category_code = targetMediaCode/);
  assert.match(appSource, /operation: "ARCHIVE"/);
  assert.match(appSource, /className=\{`btn task-bulk-delete/);
  assert.match(styleSource, /\.task-bulk-toolbar > button[\s\S]*font-family:\s*"Pretendard Variable"/);
  assert.match(styleSource, /\.task-bulk-toolbar > button\.primary/);
  assert.match(styleSource, /button:not\(\.primary\):not\(\.task-bulk-delete\)/);
  assert.match(styleSource, /\.task-schedule-row\.is-drop-before/);
  assert.match(styleSource, /\.g-row\.is-drop-after/);
  assert.match(styleSource, /content: "여기에 이동"/);
});

test("간트 포인터는 업무 행과 날짜 열을 동시에 강조한다", () => {
  assert.match(appSource, /onPointerMove=\{highlightGanttAxes\}/);
  assert.match(appSource, /data-gantt-day-index=\{dayIndex\}/);
  assert.match(appSource, /data-gantt-row-index=\{rowIndex\}/);
  assert.match(styleSource, /\.reference-gantt \.g-row\.is-axis-hover-row/);
  assert.match(styleSource, /\.reference-gantt \.g-d\.is-axis-hover-column/);
  assert.match(styleSource, /\.g-c\.is-axis-hover-intersection/);
});

test("기한이 지난 보류 업무는 간트에 실시간·고정 지연 구간을 구분해 표시한다", () => {
  assert.match(appSource, /overdueTaskHoldRange\(task, today\)/);
  assert.match(appSource, /overdue-hold \$\{overdueHold\.live \? "is-live" : "is-frozen"\}/);
  assert.match(appSource, /기한 초과 보류 \$\{day\.iso\}/);
  assert.match(appSource, /className="g-overdue-hold-legend"/);
  assert.match(styleSource, /\.g-c\.overdue-hold\.is-live::before[\s\S]*repeating-linear-gradient/);
  assert.match(styleSource, /\.g-c\.overdue-hold\.is-frozen::before[\s\S]*background:\s*#687282/);
});

test("일정표 아래 확인 요청은 카드형 상태 탭을 제공하고 원장 전환을 제거한다", () => {
  assert.match(appSource, /function ProjectIssuePanel/);
  assert.match(appSource, /<IssueRequestCard key=\{issue\.id\}/);
  assert.doesNotMatch(appSource, /원장 편집|카드로 보기|ledgerOpen/);
  assert.match(appSource, /project-issue-status-tabs/);
  assert.match(appSource, /확인완료 <b>\{doneCount\}/);
  assert.match(appSource, /issueStatusOrder = \["NOT_STARTED", "IN_PROGRESS", "DONE", "ON_HOLD"\]/);
  assert.match(appSource, /deleteArmed \? "삭제\?" : "×"/);
  assert.match(appSource, /onBlur=\{\(event\) => void commitField\("body_text"/);
  assert.match(appSource, /entityType: "project_issue", operation: "CREATE"/);
  assert.match(appSource, /entityType: "project_issue",[\s\S]*operation: "ARCHIVE"/);
  assert.match(styleSource, /#issueTable[\s\S]*min-width:\s*1080px/);
});

test("업무 로그에서도 일정표·간트·업무 로그 탭을 유지하고 양방향으로 전환한다", () => {
  assert.match(appSource, /<TaskWorkspaceTabs activeView=\{displayMode\}/);
  assert.match(appSource, /nextView === "gantt" \|\| nextView === "activity"/);
  assert.match(appSource, /activityMode \? "업무 로그"/);
  assert.match(appSource, /className="task-change-log is-embedded"/);
  assert.doesNotMatch(appSource, /className="task-activity-navigation"/);
  assert.doesNotMatch(appSource, /className="view-stack tracker-view task-activity-view"/);
  assert.match(styleSource, /\.task-workspace-tabs button\[aria-selected="true"\]/);
});

test("기존 총괄 진입은 내부 통합관리로, 고객은 허용 일정으로 전환한다", () => {
  assert.match(appSource, /if \(actorRole !== "client"\) setView\("portfolio"\)/);
  assert.match(appSource, /view !== "overview"/);
  assert.match(appSource, /isViewAllowed\("schedule", allowedPages\)/);
  assert.match(appSource, /\? "schedule" : firstAllowedView/);
  assert.match(appSource, /NAVIGATION_PAGE_OPTIONS\.filter\(\(page\) => page\.id !== "overview"\)/);
});

test("통합 관리는 프로젝트 선택보다 위의 독립 탐색 항목이며 프로젝트 컨텍스트를 비활성화한다", () => {
  assert.match(appSource, /className="sidebar-global-nav"/);
  assert.match(appSource, /const projectNavItems = visibleNavItems\.filter\(\(item\) => !WORKSPACE_VIEWS.has\(item.id\)\)/);
  assert.match(appSource, /const projectContextActive = !WORKSPACE_VIEWS.has\(activeView\)/);
  assert.match(appSource, /workspaceMode \? "전체 프로젝트" : project\.clientName/);
  assert.doesNotMatch(appSource, /view === "portfolio" && role !== "client"/);
});

test("일정표 URL로 새로고침해도 서버 초기 업무 코드로 정규화한다", () => {
  assert.match(appSource, /return view === "schedule" \? "tasks" : view/);
  assert.match(appSource, /source\.bootstrap\(\{ initialView: serverInitialView\(view\) \}\)/);
  assert.match(appSource, /source\.login\(\{ \.\.\.credentials, initialView: serverInitialView\(view\) \}\)/);
});

test("고객사 계정 모달은 넓은 단일 폼에서 프로젝트 하위 권한을 따로 고른다", () => {
  assert.match(permissionsSource, /const pageGroups = \[/);
  assert.match(permissionsSource, /PROJECT_NAVIGATION_GROUP\.pageIds\.includes\(page\.id\)/);
  assert.match(permissionsSource, /className="access-page-groups"/);
  assert.match(styleSource, /\.create-modal\.access-account-modal\s*\{\s*width:\s*min\(960px/);
  assert.match(styleSource, /\.access-account-modal form\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(styleSource, /\.access-page-groups\s*\{[^}]*grid-template-columns:/);
});

test("업무 일정은 상태·카테고리·주간 필터를 한 화면에서 제공한다", () => {
  assert.match(appSource, /scheduleStatusFilters/);
  assert.match(appSource, /scheduleCategoryFilters/);
  assert.match(appSource, /scheduleWeekFilters/);
  assert.match(appSource, /taskResponsibleOrgLabel\(task\.responsibleOrgCode, project\.clientName/);
});

test("진행률은 날짜 계산 없이 원장 입력값만 사용한다", () => {
  assert.match(appSource, /task\.progressPercent \?\? 0/);
  assert.doesNotMatch(appSource, /progressOf\(/);
});

test("생성 후 24시간 업무는 일정표·간트와 우측 상단 알림 센터에서 같은 신규 상태를 사용한다", () => {
  assert.match(appSource, /isNewTask\(task, freshnessNow\)/);
  assert.match(appSource, /function TaskNotificationCenter/);
  assert.match(appSource, /className="notification-center"/);
  assert.match(appSource, /className="notification-popover"/);
  assert.match(appSource, /notificationTasks=\{notificationTasks\}/);
  assert.match(appSource, /className="task-new-badge"/);
  assert.match(appSource, /className="g-new-badge"/);
  assert.match(appSource, /sessionStorage\?\.setItem\(storageKey, JSON\.stringify\(next\)\)/);
  assert.match(styleSource, /\.task-schedule-row\.is-new-task/);
  assert.match(styleSource, /\.g-row\.is-new-task/);
  assert.match(styleSource, /\.notification-trigger/);
  assert.match(styleSource, /\.notification-count/);
});

test("업무표는 고정 헤더와 고정 업무명 열을 제공한다", () => {
  assert.match(styleSource, /\.task-schedule-matrix thead th[\s\S]*position:\s*sticky/);
  assert.match(styleSource, /\.task-schedule-matrix thead tr:first-child > th:first-child,[\s\S]*position:\s*sticky/);
});

test("간트는 가장 긴 업무명에 맞추고 남는 폭을 다음 날짜로 채운다", () => {
  assert.match(appSource, /const GANTT_DAY_WIDTH = 24/);
  assert.match(appSource, /ganttTaskLabelWidth\(filteredTasks, \{ canWrite, showOwners \}\)/);
  assert.match(appSource, /ganttViewportWidth - ganttLabelWidth/);
  assert.match(appSource, /"--gantt-label-width": `\$\{ganttLabelWidth\}px`/);
  assert.match(appSource, /"--gantt-day-width": `\$\{GANTT_DAY_WIDTH\}px`/);
  assert.match(styleSource, /\.g-lbl\s*\{[\s\S]*flex:\s*0 0 var\(--gantt-label-width, 360px\)/);
  assert.match(styleSource, /\.g-c\s*\{[\s\S]*flex:\s*0 0 var\(--gantt-day-width, 24px\)/);
  assert.match(styleSource, /\.g-row \.g-lbl\s*\{[\s\S]*height:\s*32px/);
});

test("왼쪽 패널에서 프로젝트와 메뉴를 함께 펼치며 상단에는 선택기를 중복하지 않는다", () => {
  assert.doesNotMatch(appSource, /function ClientRail/);
  assert.match(appSource, /className="sidebar-company-list" aria-label="프로젝트 회사 선택"/);
  assert.doesNotMatch(appSource, /className="topbar-company-tabs"/);
  assert.match(appSource, /clients=\{bootstrapState\.data\.clients\} activeClient=\{selectedClient\.id\} onSelectClient=\{selectClient\}/);
  assert.match(appSource, /<ProjectSidebar project=\{project\}/);
  assert.doesNotMatch(appSource, /className="project-switcher"/);
  assert.doesNotMatch(appSource, /className="phase-brief"/);
  assert.match(appSource, /className="sidebar-toggle"/);
  assert.match(appSource, /hidden=\{!visible\}/);
  assert.match(appSource, /else setDesktopSidebarCollapsed/);
  assert.doesNotMatch(appSource, /setDesktopNavigationLevel/);
  assert.match(styleSource, /\.app-shell[\s\S]*grid-template-columns:\s*224px minmax\(0, 1fr\)/);
});

test("포켓·NS 내부 계정은 왼쪽 하단에서 프로젝트 생성과 견적 불러오기를 실행한다", () => {
  assert.match(appSource, /<footer className="sidebar-project-tools">/);
  assert.match(appSource, /className="sidebar-project-create"/);
  assert.match(appSource, /className="sidebar-project-import"/);
  assert.doesNotMatch(appSource, /className="topbar-project-create"/);
  assert.match(appSource, /function ProjectCreateModal/);
  assert.match(appSource, /\["pocket", "ns"\]\.includes\(role\)/);
  assert.match(appSource, /source\.createProject\(payload\)/);
  assert.match(appSource, /setActiveClient\(createdClientId\)/);
  assert.match(appSource, /setActiveProjectId\(createdProjectId\)/);
});

test("포켓과 NS 계정은 고객 권한 관리 화면을 함께 사용한다", () => {
  assert.match(appSource, /function canManageClientAccess\(role\)/);
  assert.match(appSource, /role === "pocket" \|\| role === "ns"/);
  assert.match(appSource, /accessManagerOnly:\s*true/);
  assert.match(permissionsSource, /canDisableAccount=\{role === "pocket"\}/);
});

test("견적서를 검토한 뒤 새 프로젝트 또는 현재 프로젝트 업무로 생성한다", () => {
  assert.match(appSource, /lazy\(\(\) => import\("\.\/QuoteImportModal\.jsx"\)\)/);
  assert.match(quoteSource, /function QuoteImportModal/);
  assert.match(appSource, /견적서 불러오기/);
  assert.match(quoteSource, /현재 프로젝트에 추가/);
  assert.match(quoteSource, /새 프로젝트로 만들기/);
  assert.match(appSource, /source\.importQuoteTasks/);
  assert.match(styleSource, /\.quote-item-table/);
});

test("왼쪽 프로젝트 메뉴는 기존 화면과 실행계획 하위 화면을 연결한다", () => {
  assert.match(appSource, /function ProjectSidebar/);
  assert.match(appSource, /visibleNavItems\.map/);
  assert.match(appSource, /visiblePlanChildren\.map/);
  assert.match(appSource, /onView\("plan", child\.id\)/);
});
