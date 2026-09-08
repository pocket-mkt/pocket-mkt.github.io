import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboardCss = readFileSync(new URL("../src/operationsDashboardEnhancements.css", import.meta.url), "utf8");
const progressCss = readFileSync(new URL("../src/progressView.css", import.meta.url), "utf8");
const meetingCss = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("회의 내용은 통합관리·진행상황·회의록 화면에서 진한 본문과 읽을 수 있는 크기를 유지한다", () => {
  assert.match(dashboardCss, /\.ops-meeting-body p,[\s\S]*color: #171d29;[\s\S]*font-size: 13px;/);
  assert.match(dashboardCss, /\.ops-workspace-daily \.ops-meeting-body ul \{ color: #161c27; font-size: 14px;/);
  assert.match(dashboardCss, /\.ops-focus-columns li > strong \{ color: #171d29; font-size: 13px;/);
  assert.match(progressCss, /\.pb-meeting-points li \{[^}]*color:#171d29; font-size:13px;/);
  assert.match(progressCss, /\.pb-meeting-discussion p \{[^}]*color:#171d29; font-size:13px;/);
  assert.match(meetingCss, /\.daily-meeting-sections p \{[\s\S]*color: #171d29;[\s\S]*font-size: 14px;/);
});
