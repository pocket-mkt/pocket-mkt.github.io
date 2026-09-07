export const PAGE_CATALOG = Object.freeze([
  Object.freeze({ id: "overview", label: "총괄 현황", description: "프로젝트 요약과 최근 업데이트", navigation: true, customerSelectable: true }),
  Object.freeze({ id: "plan", label: "실행계획", description: "클라이언트 공유용 실행계획", navigation: true, customerSelectable: true }),
  Object.freeze({ id: "tasks", label: "업무", description: "업무 일정·간트·업무 로그", navigation: true, customerSelectable: true, nested: true }),
  Object.freeze({ id: "progress", label: "진행상황", description: "완료·예정 업무와 확인 요청 요약", navigation: true, customerSelectable: true, nested: true }),
  Object.freeze({ id: "schedule", label: "일정표", permissionId: "tasks", navigation: false, customerSelectable: false, nested: true }),
  Object.freeze({ id: "daily", label: "데일리 회의록", description: "날짜별 회의 내용과 후속 업무", navigation: true, customerSelectable: true, nested: true }),
  Object.freeze({ id: "credentials", label: "아이디 관리대장", description: "사이트 계정과 비밀번호 보관", navigation: true, customerSelectable: false, nested: true }),
  Object.freeze({ id: "content", label: "콘텐츠", navigation: false, customerSelectable: false }),
  Object.freeze({ id: "tracking", label: "성과 추적", navigation: false, customerSelectable: false }),
  Object.freeze({ id: "performance", label: "성과", description: "핵심 KPI와 실적", navigation: true, customerSelectable: true }),
  Object.freeze({ id: "files", label: "세부 로그", description: "프로젝트 변경 이력", navigation: true, customerSelectable: true }),
]);

export const ACCESS_PAGE_OPTIONS = Object.freeze(PAGE_CATALOG.filter((page) => page.customerSelectable));
export const NAVIGATION_PAGE_OPTIONS = Object.freeze(PAGE_CATALOG.filter((page) => page.navigation));
// Navigation folder only: never create a route or grant from this group ID.
export const PROJECT_NAVIGATION_GROUP = Object.freeze({
  id: "project-pages", label: "프로젝트", pageIds: Object.freeze(["tasks", "progress", "daily", "credentials"]),
});

export const ACCESS_PAGE_KEYS = Object.freeze(ACCESS_PAGE_OPTIONS.map((page) => page.id));

export function normalizeAllowedPages(value) {
  const requested = Array.isArray(value) ? value.map((item) => String(item || "").toLowerCase()) : [];
  return ACCESS_PAGE_KEYS.filter((page) => requested.includes(page));
}

export function firstAllowedView(value) {
  return normalizeAllowedPages(value)[0] || "overview";
}

export function isViewAllowed(view, allowedPages) {
  const normalized = String(view || "overview").toLowerCase();
  if (normalized === "permissions") return false;
  if (normalized === "credentials") return false;
  if (normalized === "content" || normalized === "tracking") return false;
  if (normalized === "schedule") return normalizeAllowedPages(allowedPages).includes("tasks");
  return normalizeAllowedPages(allowedPages).includes(normalized);
}

export function accountSubmission(fields = {}) {
  const submission = {
    operation: "UPSERT",
    account: String(fields.account || "").trim(),
    displayName: String(fields.displayName || "").trim(),
    accessCode: String(fields.accessCode || ""),
    projectId: String(fields.projectId || "").trim(),
    allowedPages: normalizeAllowedPages(fields.allowedPages),
    enabled: fields.enabled !== false,
  };
  if (fields.membershipId) submission.membershipId = String(fields.membershipId);
  return submission;
}

export function removeAccessSubmission(fields = {}, access = {}) {
  return {
    operation: "REMOVE_ACCESS",
    account: String(fields.account || "").trim(),
    displayName: String(fields.displayName || "").trim(),
    projectId: String(access.projectId || "").trim(),
    membershipId: String(access.id || access.membershipId || "").trim(),
    allowedPages: normalizeAllowedPages(access.allowedPages),
  };
}
