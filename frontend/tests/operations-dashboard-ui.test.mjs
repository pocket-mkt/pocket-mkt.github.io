import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const dashboardSource = readFileSync(new URL("../src/OperationsDashboardView.jsx", import.meta.url), "utf8");

test("통합 관리는 확인 요청 원장과 이동 가능한 평일 마감 업무를 프로젝트별로 보여준다", () => {
  assert.match(dashboardSource, /import \{[^}]*ArrowRight[^}]*\} from "lucide-react"/);
  assert.match(dashboardSource, /확인 요청 상세/);
  assert.match(dashboardSource, /이슈사항 · 추가요청 기록/);
  assert.match(dashboardSource, /이전 주차/);
  assert.match(dashboardSource, /다음 주차/);
  assert.match(dashboardSource, /weekLabel/);
  assert.match(dashboardSource, /selectedWeek\.to/);
  assert.doesNotMatch(dashboardSource, /관련 업무 열기/);
  assert.match(dashboardSource, /ProjectTabs projects=\{dashboard\.projects\}/);
  assert.match(appSource, /onLoadWeek=\{\(startDate, endDate\)/);
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
