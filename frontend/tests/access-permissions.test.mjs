import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCESS_PAGE_KEYS,
  ACCESS_PAGE_OPTIONS,
  NAVIGATION_PAGE_OPTIONS,
  PROJECT_NAVIGATION_GROUP,
  accountSubmission,
  firstAllowedView,
  isViewAllowed,
  normalizeAllowedPages,
  removeAccessSubmission,
} from "../src/accessPermissions.js";

test("고객 권한은 알려진 페이지 코드만 중복 없이 보존한다", () => {
  assert.deepEqual(
    normalizeAllowedPages(["tasks", "overview", "tasks", "unknown"]),
    ["overview", "tasks"],
  );
});

test("운영 메뉴와 고객 권한 선택지는 페이지 카탈로그에서 파생한다", () => {
  assert.deepEqual(ACCESS_PAGE_KEYS, ["overview", "plan", "tasks", "progress", "daily", "performance"]);
  assert.deepEqual(ACCESS_PAGE_OPTIONS.map((page) => page.label), ["총괄 현황", "실행계획", "업무", "진행상황 - 클라이언트", "데일리 회의록", "성과"]);
  assert.equal(isViewAllowed("files", ["files"]), false);
  assert.deepEqual(NAVIGATION_PAGE_OPTIONS.map((page) => page.id), ["overview", "portfolio", "plan", "tasks", "progress", "client-progress", "daily", "credentials", "performance", "files"]);
});

test("프로젝트는 업무·진행상황·회의록·내부 계정대장의 탐색 폴더이다", () => {
  assert.deepEqual(PROJECT_NAVIGATION_GROUP.pageIds, ["tasks", "progress", "client-progress", "daily", "credentials"]);
  assert.equal(PROJECT_NAVIGATION_GROUP.label, "프로젝트");
  assert.equal(NAVIGATION_PAGE_OPTIONS.some(page => page.id === PROJECT_NAVIGATION_GROUP.id), false);
  assert.equal(ACCESS_PAGE_KEYS.includes(PROJECT_NAVIGATION_GROUP.id), false);
  assert.equal(ACCESS_PAGE_KEYS.includes("progress"), true);
  assert.equal(isViewAllowed(PROJECT_NAVIGATION_GROUP.id, ACCESS_PAGE_KEYS), false);
});

test("고객에게 허용된 첫 화면과 실행계획 하위 경로를 판정한다", () => {
  assert.equal(firstAllowedView(["performance", "files"]), "performance");
  assert.equal(isViewAllowed("plan", ["plan"]), true);
  assert.equal(isViewAllowed("tasks", ["plan"]), false);
  assert.equal(isViewAllowed("daily", ["tasks"]), false);
  assert.equal(isViewAllowed("daily", ["daily"]), true);
  assert.equal(isViewAllowed("schedule", ["tasks"]), true);
  assert.equal(isViewAllowed("progress", ["progress"]), false);
  assert.equal(isViewAllowed("client-progress", ["progress"]), true);
  assert.equal(isViewAllowed("client-progress", ["tasks"]), true);
  assert.equal(firstAllowedView(["progress"]), "client-progress");
  assert.equal(isViewAllowed("progress", ["tasks"]), false);
  assert.equal(isViewAllowed("progress", ["daily"]), false);
  assert.equal(isViewAllowed("content", ["content"]), false);
  assert.equal(isViewAllowed("tracking", ["tracking"]), false);
  assert.equal(isViewAllowed("permissions", ACCESS_PAGE_KEYS), false);
  assert.equal(isViewAllowed("portfolio", ACCESS_PAGE_KEYS), false);
  assert.equal(isViewAllowed("credentials", ACCESS_PAGE_KEYS), false);
});

test("고객 계정 저장 요청은 프로젝트와 페이지 권한을 명시한다", () => {
  const submission = accountSubmission({
    account: "client-und",
    displayName: "UND 고객",
    accessCode: "client-password",
    projectId: "PRJ-UND",
    allowedPages: ["overview", "tasks"],
    enabled: true,
  });
  assert.deepEqual(submission, {
    operation: "UPSERT",
    account: "client-und",
    displayName: "UND 고객",
    accessCode: "client-password",
    projectId: "PRJ-UND",
    allowedPages: ["overview", "tasks"],
    enabled: true,
  });
});

test("기존 고객 계정 수정은 현재 권한 행을 이어서 갱신한다", () => {
  const submission = accountSubmission({
    account: "client-und",
    displayName: "UND 고객",
    projectId: "PRJ-UND",
    membershipId: "MEM-UND-CLIENT",
    allowedPages: ["overview", "performance"],
  });
  assert.equal(submission.membershipId, "MEM-UND-CLIENT");
});

test("프로젝트 권한 제거는 계정 전체가 아닌 선택한 멤버십만 지정한다", () => {
  const submission = removeAccessSubmission(
    { account: " und ", displayName: "UND" },
    { id: "MEM-MUGUK-USR-UND", projectId: "PRJ-MUGUK-MKT-001", allowedPages: ["tasks", "unknown"] },
  );

  assert.deepEqual(submission, {
    operation: "REMOVE_ACCESS",
    account: "und",
    displayName: "UND",
    projectId: "PRJ-MUGUK-MKT-001",
    membershipId: "MEM-MUGUK-USR-UND",
    allowedPages: ["tasks"],
  });
});
