import assert from "node:assert/strict";
import test from "node:test";

import { getNavigationPresentation } from "../src/navigationState.js";
import { parseViewLocation, viewLocationHash, viewResourceKey } from "../src/planNavigation.js";
import { firstAllowedView, isViewAllowed } from "../src/accessPermissions.js";

test("bare-site entry opens portfolio while explicit routes and client restrictions remain", () => {
  for (const hash of ["", "#", "#unknown"]) assert.equal(parseViewLocation(hash).view, "portfolio");
  assert.equal(parseViewLocation("#tasks/schedule").view, "schedule");
  assert.equal(parseViewLocation("#daily").view, "daily");
  assert.equal(parseViewLocation("#tasks/client-progress").view, "client-progress");
  assert.equal(isViewAllowed(parseViewLocation("").view, ["tasks", "progress"]), false);
  assert.notEqual(firstAllowedView(["tasks", "progress"]), "portfolio");
});

test("데스크톱은 접힌 왼쪽 레일에서 프로젝트와 메뉴를 함께 펼친다", () => {
  const initial = getNavigationPresentation({ role: "pocket" });
  assert.equal(initial.usesDrawer, false);
  assert.equal(initial.controlVisible, true);
  assert.equal(initial.projectSidebarVisible, false);
  assert.equal(initial.projectSidebarCollapsed, true);
  assert.equal(initial.iconDirection, "right");
  assert.equal(initial.controlledIds, "project-navigation-content");
  const expanded = getNavigationPresentation({ role: "pocket", desktopCollapsed: false });
  assert.equal(expanded.projectSidebarVisible, true);
  assert.equal(expanded.iconDirection, "left");
  assert.equal(expanded.isDrawerOpen, false);
});

test("작은 화면에서는 포켓·NS 계정도 임시 탐색 서랍을 사용한다", () => {
  const navigation = getNavigationPresentation({ role: "ns", compactViewport: true, drawerOpen: true });

  assert.equal(navigation.usesDrawer, true);
  assert.equal(navigation.isDrawerOpen, true);
  assert.equal(navigation.projectSidebarVisible, true);
  assert.equal(navigation.controlledIds, "project-navigation-content");
});

test("실행계획 하위 화면은 URL과 캐시 키에서 서로 분리된다", () => {
  assert.deepEqual(parseViewLocation("#plan/client"), { view: "plan", planVariant: "client" });
  assert.deepEqual(parseViewLocation("#plan/internal"), { view: "plan", planVariant: "internal" });
  assert.deepEqual(parseViewLocation("#plan"), { view: "plan", planVariant: "client" });
  assert.deepEqual(parseViewLocation("#tasks/schedule"), { view: "schedule", planVariant: "client" });
  assert.deepEqual(parseViewLocation("#daily"), { view: "daily", planVariant: "client" });
  assert.equal(viewLocationHash("plan", "internal"), "plan/internal");
  assert.equal(viewLocationHash("schedule"), "tasks/schedule");
  assert.equal(viewResourceKey("schedule"), "tasks");
  assert.equal(viewResourceKey("plan", "client"), "plan-client");
  assert.equal(viewResourceKey("plan", "internal"), "plan-internal");
});
