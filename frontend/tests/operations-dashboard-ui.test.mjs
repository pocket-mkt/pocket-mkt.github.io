import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const dashboardSource = readFileSync(new URL("../src/OperationsDashboardView.jsx", import.meta.url), "utf8");
const dashboardEnhancementsCss = readFileSync(new URL("../src/operationsDashboardEnhancements.css", import.meta.url), "utf8");
const requestCardSource = readFileSync(new URL("../src/IssueRequestCard.jsx", import.meta.url), "utf8");
const viewModelSource = readFileSync(new URL("../src/api/viewModel.js", import.meta.url), "utf8");
const progressDeltaMigration = readFileSync(new URL("../../supabase/migrations/20260908002729_add_operations_progress_daily_delta.sql", import.meta.url), "utf8");
const issueInteractionMigration = readFileSync(new URL("../../supabase/migrations/20260908094500_expose_operations_issue_interaction_fields.sql", import.meta.url), "utf8");
const confirmationWorkflowMigration = readFileSync(new URL("../../supabase/migrations/20260908114500_confirmation_request_workflow.sql", import.meta.url), "utf8");
const requestCreateSource = readFileSync(new URL("../src/IssueRequestCreateModal.jsx", import.meta.url), "utf8");

test("통합 관리는 처리 가능한 확인 요청과 이동 가능한 평일 마감 업무를 프로젝트별로 보여준다", () => {
  assert.match(dashboardSource, /import \{[^}]*ArrowRight[^}]*\} from "lucide-react"/);
  assert.match(dashboardSource, /확인 요청 상세/);
  assert.match(dashboardSource, /<IssueRequestCard key=\{displayedIssue\.id\} issue=\{displayedIssue\}/);
  assert.match(dashboardSource, /onIssueUpdate/);
  assert.match(dashboardSource, /이전 주차/);
  assert.match(dashboardSource, /다음 주차/);
  assert.match(dashboardSource, /weekLabel/);
  assert.match(dashboardSource, /selectedWeek\.to/);
  assert.doesNotMatch(dashboardSource, /관련 업무 열기/);
  assert.match(dashboardSource, /ProjectTabs projects=\{dashboard\.projects\}/);
  assert.match(appSource, /onLoadWeek=\{\(startDate, endDate\)/);
});

test("확인 요청을 처음 열 때 내부 상태 반영 전에도 선택 항목으로 상세 모달을 그린다", () => {
  assert.match(dashboardSource, /const displayedIssue = current\?\.id === issue\.id \? current : issue/);
  assert.match(dashboardSource, /<IssueRequestCard key=\{displayedIssue\.id\} issue=\{displayedIssue\}/);
  assert.doesNotMatch(dashboardSource, /<small>\{current\.clientName\} · \{current\.projectName\}<\/small>/);
});

test("진행상황·업무 하단·통합관리는 같은 확인요청 카드와 Supabase 행 버전을 사용한다", () => {
  assert.match(requestCardSource, /답변 작성/);
  assert.match(requestCardSource, /마감일 변경/);
  assert.match(requestCardSource, /확인 완료/);
  assert.match(requestCardSource, /한 번 더 눌러 삭제/);
  assert.match(requestCardSource, /appendBriefReply\(current, reply, actorName\)/);
  assert.match(appSource, /<OperationsDashboardView[^>]*actorName=\{actorName\}[^>]*onIssueUpdate=\{onIssueUpdate\}/);
  assert.match(viewModelSource, /rowVersion: Number\(row\.row_version \|\| 0\)/);
  assert.match(issueInteractionMigration, /'remarks', source\.remarks/);
  assert.match(issueInteractionMigration, /'row_version', source\.row_version/);
  assert.match(dashboardSource, /확인 완료/);
  assert.match(dashboardSource, /남긴 사람/);
  assert.match(dashboardSource, /<IssueRequestCreateModal/);
  assert.match(requestCreateSource, /확인할 사람/);
  assert.match(requestCreateSource, /남긴 사람/);
  assert.match(confirmationWorkflowMigration, /add column requester_text/);
  assert.match(confirmationWorkflowMigration, /read_operations_dashboard_with_confirmation_history/);
});

test("업무 체크는 퍼센트 없이 완료 여부를 표시하고 과거 API 호환성은 보존한다", () => {
  assert.doesNotMatch(dashboardSource, /task\.progressDeltaToday/);
  assert.match(dashboardSource, /ops-task-completion/);
  assert.match(dashboardSource, /미완료/);
  assert.match(progressDeltaMigration, /event\.before_data -> 'progress_percent' is distinct from event\.after_data -> 'progress_percent'/);
  assert.match(progressDeltaMigration, /event\.created_at >= seoul_today_start/);
  assert.match(progressDeltaMigration, /'progress_delta_today'/);
  assert.match(progressDeltaMigration, /security invoker/);
});

test("내부 데일리 회의록은 월요일 고정 주차 탐색과 주간 핵심 사안을 제공한다", () => {
  assert.match(dashboardSource, /export function WorkspaceDailyMeetingsView/);
  assert.match(dashboardSource, /전체 업체/);
  assert.match(dashboardSource, /이전 주차/);
  assert.match(dashboardSource, /다음 주차/);
  assert.match(dashboardSource, /const dates = Array\.from\(\{ length: 5 \}, \(_, index\) => moveDate\(week\.from, index\)\)/);
  assert.match(dashboardSource, /weekLabel\(week\.from\)/);
  assert.match(dashboardSource, /날짜 선택/);
  assert.match(dashboardSource, /놓치면 안 되는 주간 사안/);
  assert.match(dashboardSource, /meetingWeekItems/);
  assert.match(dashboardSource, /계속 확인할 요청/);
  assert.match(dashboardSource, /\["DONE", "CLOSED", "COMPLETED", "CANCELLED"\]/);
  assert.match(dashboardSource, /회의내용 추가/);
  assert.match(dashboardSource, /MISC_PREFIX = "\[기타\]"/);
  assert.match(dashboardSource, /saveProjectId/);
  assert.match(dashboardSource, /visibility_code: "PROJECT_TEAM"/);
  assert.match(appSource, /WorkspaceDailyMeetingsView dashboard=\{data\}/);
  assert.match(appSource, /onLoadWeek=\{\(startDate, endDate\)/);
  assert.match(appSource, /projectIdOverride/);
});

test("회의내용 추가는 프로젝트별 독립 입력 카드를 가로로 펼치고 참석자 없이 입력된 업체만 저장한다", () => {
  assert.match(dashboardSource, /Object\.fromEntries\(projects\.map/);
  assert.match(dashboardSource, /ops-compose-projects/);
  assert.match(dashboardSource, /hasContent\(entries\[project\.id\]\)/);
  assert.match(dashboardSource, /for \(const project of readyProjects\)/);
  assert.match(dashboardSource, /attendees_text: ""/);
  assert.doesNotMatch(dashboardSource, /<span>참석자<\/span>/);
  assert.match(dashboardEnhancementsCss, /grid-auto-flow: column/);
  assert.match(dashboardEnhancementsCss, /overflow-x: auto/);
});
