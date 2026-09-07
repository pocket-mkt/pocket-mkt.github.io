import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const dashboardSource = readFileSync(new URL("../src/OperationsDashboardView.jsx", import.meta.url), "utf8");

test("통합 관리는 확인 요청 상세와 주간 마감 업무를 프로젝트별로 보여준다", () => {
  assert.match(dashboardSource, /확인 요청 상세/);
  assert.match(dashboardSource, /이번 주 마감/);
  assert.match(dashboardSource, /지난주 마감/);
  assert.match(dashboardSource, /ProjectTabs projects=\{dashboard\.projects\}/);
});

test("내부 데일리 회의록은 전체 업체와 최근 7일 탐색 및 직접 저장을 제공한다", () => {
  assert.match(dashboardSource, /export function WorkspaceDailyMeetingsView/);
  assert.match(dashboardSource, /전체 업체/);
  assert.match(dashboardSource, /이전 7일/);
  assert.match(dashboardSource, /날짜 선택/);
  assert.match(dashboardSource, /회의내용 추가/);
  assert.match(dashboardSource, /visibility_code: "PROJECT_TEAM"/);
  assert.match(appSource, /WorkspaceDailyMeetingsView dashboard=\{data\}/);
  assert.match(appSource, /projectIdOverride/);
});

