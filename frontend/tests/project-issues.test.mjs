import assert from "node:assert/strict";
import test from "node:test";

import { projectIssueViewModel, tasksViewModel } from "../src/api/viewModel.js";

test("프로젝트 이슈 원장 응답은 화면 직접 편집 필드와 행 버전을 보존한다", () => {
  const issue = projectIssueViewModel({
    issue_id: 42,
    issue_date: "2026-09-03T00:00:00Z",
    due_date: "2026-09-08",
    kind_text: "추가업무",
    related_task_text: "채널 세팅",
    body_text: "프로필 문구 수정",
    owner_text: "NS",
    requester_text: "남상민",
    status_code: "IN_PROGRESS",
    completion_url: "https://example.com/result",
    remarks: "고객 요청",
    visibility_code: "CLIENT",
    row_version: 3,
  });
  assert.deepEqual(issue, {
    id: 42,
    date: "2026-09-03",
    dueDate: "2026-09-08",
    kind: "추가업무",
    relatedTask: "채널 세팅",
    body: "프로필 문구 수정",
    owner: "NS",
    requester: "남상민",
    statusCode: "IN_PROGRESS",
    completionUrl: "https://example.com/result",
    remarks: "고객 요청",
    visibilityCode: "CLIENT",
    createdAt: null,
    updatedAt: null,
    rowVersion: 3,
  });
});

test("업무 워크스페이스 뷰모델은 이슈 목록과 서버 쓰기 권한을 함께 전달한다", () => {
  const result = tasksViewModel({ data: {
    items: [],
    members: [],
    issues: [{ issue_id: 9, issue_date: "2026-09-03", body_text: "확인" }],
    issueCanWrite: true,
    totalMatching: 0,
  } });
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].id, 9);
  assert.equal(result.issueCanWrite, true);
});
