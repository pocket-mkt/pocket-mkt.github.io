import assert from "node:assert/strict";
import test from "node:test";

import { readApiConfig } from "../src/api/config.js";
import { createHubDataSource } from "../src/api/dataSource.js";
import { OfflineMutationError } from "../src/api/errors.js";
import { HubApiError } from "../src/api/errors.js";
import { createHubApi } from "../src/api/hubApi.js";
import { createSessionStore } from "../src/api/session.js";
import { activityListViewModel, bootstrapViewModel, overviewViewModel, performanceTrackingViewModel, tasksViewModel, workspaceViewModel } from "../src/api/viewModel.js";

test("API URL이 없으면 설정 오류를 명확히 반환한다", async () => {
  const config = readApiConfig({ VITE_POCKET_API_MODE: "auto" });
  const source = createHubDataSource({ config });

  await assert.rejects(
    source.bootstrap({ role: "pocket" }),
    (error) => error instanceof HubApiError && error.code === "missing_api_url",
  );
});

test("로그인 비활성화 설정을 명시적으로 읽는다", () => {
  const config = readApiConfig({
    VITE_POCKET_API_MODE: "auto",
    VITE_POCKET_LOGIN_ENABLED: "false",
  });
  assert.equal(config.loginEnabled, false);
});

test("API가 없을 때 쓰기는 저장 성공처럼 처리하지 않는다", async () => {
  const config = readApiConfig({ VITE_POCKET_API_MODE: "auto" });
  const source = createHubDataSource({ config });

  await assert.rejects(
    source.mutate({ mutation: { entity: "task", operation: "create" } }),
    OfflineMutationError,
  );
  assert.equal(source.getState().phase, "error");
});

test("live 읽기 성공 시 마지막 동기화 시각을 상태에 기록한다", async () => {
  const generatedAt = "2026-08-25T14:00:00+09:00";
  const live = {
    bootstrap: async () => ({ ok: true, generatedAt, data: { clients: [] } }),
  };
  const config = {
    endpoint: "https://example.invalid/api",
    mode: "live",
    timeoutMs: 60000,
    credentials: "omit",
    hasEndpoint: true,
    useDemoOnly: false,
  };
  const source = createHubDataSource({ config, live });

  await source.bootstrap();
  assert.equal(source.getState().mode, "live");
  assert.equal(source.getState().phase, "ready");
  assert.equal(source.getState().lastSuccessfulAt, generatedAt);
});

test("후속 탭 조회와 저장은 전역 화면 상태를 불필요하게 다시 방출하지 않는다", async () => {
  let generatedIndex = 0;
  const live = {
    getSession: () => ({ user: { userId: "USR-1" } }),
    bootstrap: async () => ({ ok: true, generatedAt: `2026-09-02T10:00:0${generatedIndex++}+09:00`, data: {} }),
    tasks: async () => ({ ok: true, generatedAt: `2026-09-02T10:00:0${generatedIndex++}+09:00`, data: { items: [] } }),
    mutate: async () => ({ ok: true, generatedAt: `2026-09-02T10:00:0${generatedIndex++}+09:00`, data: { record: {} } }),
  };
  const source = createHubDataSource({
    config: { endpoint: "https://example.invalid/api", hasEndpoint: true },
    live,
  });
  const phases = [];
  source.subscribe((state) => phases.push(state.phase));

  await source.bootstrap();
  await source.tasks({ projectId: "PRJ-1" });
  await source.mutate({ projectId: "PRJ-1", mutation: { entityType: "task", operation: "UPDATE" } });

  assert.deepEqual(phases, ["idle", "ready"]);
  assert.equal(source.getState().lastSuccessfulAt, "2026-09-02T10:00:02+09:00");
});

test("일반 저장 실패는 정상 프로젝트 읽기 상태를 전역 오류 화면으로 바꾸지 않는다", async () => {
  const failure = new HubApiError("저장 서버 지연", { code: "network_error", retriable: true });
  const live = {
    getSession: () => ({ user: { userId: "USR-1" } }),
    bootstrap: async () => ({ ok: true, generatedAt: "2026-09-03T10:00:00+09:00", data: {} }),
    mutate: async () => { throw failure; },
  };
  const source = createHubDataSource({
    config: { endpoint: "https://example.invalid/api", hasEndpoint: true },
    live,
  });
  const phases = [];
  source.subscribe((state) => phases.push(state.phase));

  await source.bootstrap();
  await assert.rejects(source.mutate({ projectId: "PRJ-1", mutation: {} }), failure);

  assert.deepEqual(phases, ["idle", "ready"]);
  assert.equal(source.getState().phase, "ready");
  assert.equal(source.getState().error.code, "network_error");
});

test("모든 live 요청은 text/plain POST이며 세션 토큰을 body로 전달한다", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const storageMap = new Map();
  const storage = {
    getItem: (key) => storageMap.get(key) || null,
    setItem: (key, value) => storageMap.set(key, value),
    removeItem: (key) => storageMap.delete(key),
  };
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url: String(url), options, body });
    const data = body.action === "login"
      ? { token: "session-token", expiresIn: 3600, user: { userId: "U-1", displayName: "포켓", role: "POCKET_MANAGER" } }
      : { currentUser: {}, clients: [], projects: [], channels: [] };
    return new Response(JSON.stringify({ ok: true, generatedAt: "2026-08-25T10:00:00+09:00", data }), { status: 200 });
  };

  try {
    const sessionStore = createSessionStore(storage);
    const api = createHubApi({ endpoint: "https://example.invalid/api", timeoutMs: 3000, credentials: "omit" }, { sessionStore });
    await api.login({ account: "pocket@hub.local", accessCode: "long-access-code" });
    await api.bootstrap();
    await api.mutate({
      projectId: "P-1",
      mutation: {
        entityType: "task",
        operation: "CREATE",
        fields: { title: "신규 업무", status_code: "NOT_STARTED" },
      },
    });
    await api.mutate({
      projectId: "P-1",
      mutation: {
        entityType: "project",
        operation: "UPDATE",
        id: "P-1",
        expectedRowVersion: 7,
        fields: { start_date: "2026-09-07" },
      },
    });
    await api.mutateBatch({
      projectId: "P-1",
      mutations: [
        { entityType: "task", operation: "UPDATE", id: "T-1", expectedRowVersion: 2, fields: { due_date: "2026-09-08" } },
        { entityType: "task", operation: "UPDATE", id: "T-2", expectedRowVersion: 4, fields: { due_date: "2026-09-09" } },
      ],
    });

    assert.equal(calls.length, 5);
    calls.forEach((call) => {
      assert.equal(call.options.method, "POST");
      assert.equal(call.options.headers["Content-Type"], "text/plain;charset=UTF-8");
      assert.ok(new URL(call.url).searchParams.get("_mh"), "Apps Script redirect cache buster is required");
    });
    assert.equal(calls[0].body.account, "pocket@hub.local");
    assert.equal(calls[0].body.includeBootstrap, true);
    assert.equal(calls[1].body.auth.sessionToken, "session-token");
    assert.equal(calls[2].body.action, "mutate");
    assert.equal(calls[2].body.auth.sessionToken, "session-token");
    assert.equal(calls[2].body.mutation.entityType, "task");
    assert.equal(calls[2].body.mutation.operation, "CREATE");
    assert.match(calls[2].body.mutation.mutationId, /^mut_/);
    assert.equal(calls[3].body.mutation.entityType, "project");
    assert.equal(calls[3].body.mutation.operation, "UPDATE");
    assert.equal(calls[3].body.mutation.expectedRowVersion, 7);
    assert.deepEqual(calls[3].body.mutation.fields, { start_date: "2026-09-07" });
    assert.equal(calls[4].body.action, "mutate_batch");
    assert.equal(calls[4].body.projectId, "P-1");
    assert.equal(calls[4].body.mutations.length, 2);
    assert.match(calls[4].body.mutations[0].mutationId, /^mut_/);
    assert.equal(calls[4].body.mutations[1].expectedRowVersion, 4);
    assert.equal(JSON.stringify([...storageMap.values()]).includes("long-access-code"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("구버전 Apps Script는 같은 mutation id를 유지한 단건 저장으로 안전하게 호환한다", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const storageMap = new Map();
  const sessionStore = createSessionStore({
    getItem: (key) => storageMap.get(key) || null,
    setItem: (key, value) => storageMap.set(key, value),
    removeItem: (key) => storageMap.delete(key),
  });
  sessionStore.write({ token: "session-token", expiresIn: 3600, user: { userId: "U-1" } });
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    if (body.action === "mutate_batch") {
      return new Response(JSON.stringify({
        ok: false,
        error: { code: "invalid_request", status: 400, message: "요청 형식이 올바르지 않습니다." },
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      ok: true,
      generatedAt: "2026-09-03T10:00:00+09:00",
      data: { mutationId: body.mutation.mutationId, record: { task_id: body.mutation.id } },
    }), { status: 200 });
  };

  try {
    const api = createHubApi({ endpoint: "https://example.invalid/api", timeoutMs: 3000, credentials: "omit" }, { sessionStore });
    const result = await api.mutateBatch({
      projectId: "P-1",
      mutations: [
        { entityType: "task", operation: "UPDATE", id: "T-1", expectedRowVersion: 1, fields: { due_date: "2026-09-08" } },
        { entityType: "task", operation: "UPDATE", id: "T-2", expectedRowVersion: 1, fields: { due_date: "2026-09-09" } },
      ],
    });
    assert.deepEqual(calls.map((call) => call.action), ["mutate_batch", "mutate", "mutate"]);
    assert.equal(calls[1].mutation.mutationId, calls[0].mutations[0].mutationId);
    assert.equal(calls[2].mutation.mutationId, calls[0].mutations[1].mutationId);
    assert.equal(result.data.fallback, true);
    assert.equal(result.data.results.length, 2);

    await api.mutateBatch({
      projectId: "P-1",
      mutations: [
        { entityType: "task", operation: "UPDATE", id: "T-3", expectedRowVersion: 1, fields: { due_date: "2026-09-10" } },
        { entityType: "task", operation: "UPDATE", id: "T-4", expectedRowVersion: 1, fields: { due_date: "2026-09-11" } },
      ],
    });
    assert.deepEqual(calls.map((call) => call.action), ["mutate_batch", "mutate", "mutate", "mutate", "mutate"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("간트 한 행 변경은 배치 지원 탐색 없이 단건 mutation 한 번만 호출한다", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const storageMap = new Map();
  const sessionStore = createSessionStore({
    getItem: (key) => storageMap.get(key) || null,
    setItem: (key, value) => storageMap.set(key, value),
    removeItem: (key) => storageMap.delete(key),
  });
  sessionStore.write({ token: "session-token", expiresIn: 3600, user: { userId: "U-1" } });
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    return new Response(JSON.stringify({
      ok: true,
      generatedAt: "2026-09-03T10:00:00+09:00",
      data: { mutationId: body.mutation.mutationId, record: { task_id: body.mutation.id } },
    }), { status: 200 });
  };

  try {
    const api = createHubApi({ endpoint: "https://example.invalid/api", timeoutMs: 3000, credentials: "omit" }, { sessionStore });
    const result = await api.mutateBatch({
      projectId: "P-1",
      mutations: [{ entityType: "task", operation: "UPDATE", id: "T-1", expectedRowVersion: 2, fields: { schedule_dates_json: "[]" } }],
    });
    assert.deepEqual(calls.map((call) => call.action), ["mutate"]);
    assert.equal(result.data.fallback, true);
    assert.equal(result.data.results.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("로그인은 세션과 최소 bootstrap을 한 응답으로 분리해 보관한다", async () => {
  const originalFetch = globalThis.fetch;
  const storageMap = new Map();
  const storage = {
    getItem: (key) => storageMap.get(key) || null,
    setItem: (key, value) => storageMap.set(key, value),
    removeItem: (key) => storageMap.delete(key),
  };
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.action, "login");
    assert.equal(body.includeBootstrap, true);
    return new Response(JSON.stringify({
      ok: true,
      generatedAt: "2026-08-31T10:00:00+09:00",
      actor: { userId: "U-1", displayName: "포켓", role: "POCKET_MANAGER" },
      data: {
        session: { token: "combined-token", expiresIn: 3600, user: { userId: "U-1", displayName: "포켓", role: "POCKET_MANAGER" } },
        bootstrap: { currentUser: { userId: "U-1" }, clients: [], projects: [], channels: [] },
      },
    }), { status: 200 });
  };

  try {
    const api = createHubApi(
      { endpoint: "https://example.invalid/api", timeoutMs: 3000, credentials: "omit" },
      { sessionStore: createSessionStore(storage) },
    );
    const result = await api.login({ account: "pocket", accessCode: "access-code" });
    assert.equal(result.data.token, "combined-token");
    assert.deepEqual(result.bootstrap.data.clients, []);
    assert.equal(api.getSession().token, "combined-token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("workspace 조회는 project_snapshot 액션으로 프로젝트 범위를 전달한다", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const storageMap = new Map();
  const storage = {
    getItem: (key) => storageMap.get(key) || null,
    setItem: (key, value) => storageMap.set(key, value),
    removeItem: (key) => storageMap.delete(key),
  };
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    const data = body.action === "login"
      ? { token: "session-token", expiresIn: 3600, user: { userId: "U-1", role: "CLIENT_VIEWER" } }
      : { plan: {}, tasks: { items: [] }, contents: { items: [] }, performance: {}, files: { items: [] }, activity: { items: [] } };
    return new Response(JSON.stringify({ ok: true, generatedAt: "2026-08-26T10:00:00+09:00", data }), { status: 200 });
  };

  try {
    const api = createHubApi(
      { endpoint: "https://example.invalid/api", timeoutMs: 3000, credentials: "omit" },
      { sessionStore: createSessionStore(storage) },
    );
    await api.login({ account: "client@example.com", accessCode: "access-code" });
    await api.workspace({ projectId: "P-1", limit: 200 });
    assert.equal(calls[1].action, "project_snapshot");
    assert.equal(calls[1].projectId, "P-1");
    assert.equal(calls[1].limit, 200);
    assert.equal(calls[1].auth.sessionToken, "session-token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("업무 로그 조회는 TASK 엔터티 필터를 API에 전달한다", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const storageMap = new Map();
  const storage = {
    getItem: (key) => storageMap.get(key) || null,
    setItem: (key, value) => storageMap.set(key, value),
    removeItem: (key) => storageMap.delete(key),
  };
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    const data = body.action === "login"
      ? { token: "session-token", expiresIn: 3600, user: { userId: "U-1", role: "POCKET_MANAGER" } }
      : { items: [] };
    return new Response(JSON.stringify({ ok: true, generatedAt: "2026-08-26T10:00:00+09:00", data }), { status: 200 });
  };

  try {
    const api = createHubApi(
      { endpoint: "https://example.invalid/api", timeoutMs: 3000, credentials: "omit" },
      { sessionStore: createSessionStore(storage) },
    );
    await api.login({ account: "manager@example.com", accessCode: "access-code" });
    await api.activity({ projectId: "P-1", entityType: "TASK", limit: 100 });

    assert.equal(calls[1].action, "activity");
    assert.equal(calls[1].projectId, "P-1");
    assert.equal(calls[1].entityType, "TASK");
    assert.equal(calls[1].limit, 100);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("실행계획 조회는 선택한 계획 유형을 API에 전달한다", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const storageMap = new Map();
  const storage = {
    getItem: (key) => storageMap.get(key) || null,
    setItem: (key, value) => storageMap.set(key, value),
    removeItem: (key) => storageMap.delete(key),
  };
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    const data = body.action === "login"
      ? { token: "session-token", expiresIn: 3600, user: { userId: "U-1", role: "POCKET_MANAGER" } }
      : { plan: {}, sections: [] };
    return new Response(JSON.stringify({ ok: true, generatedAt: "2026-08-26T10:00:00+09:00", data }), { status: 200 });
  };

  try {
    const api = createHubApi(
      { endpoint: "https://example.invalid/api", timeoutMs: 3000, credentials: "omit" },
      { sessionStore: createSessionStore(storage) },
    );
    await api.login({ account: "manager@example.com", accessCode: "access-code" });
    await api.plan({ projectId: "P-1", planType: "INTERNAL" });
    assert.equal(calls[1].action, "project_plan");
    assert.equal(calls[1].projectId, "P-1");
    assert.equal(calls[1].planType, "INTERNAL");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("공개 조회 세션도 서버 발급 토큰만 sessionStorage에 저장한다", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const storageMap = new Map();
  const storage = {
    getItem: (key) => storageMap.get(key) || null,
    setItem: (key, value) => storageMap.set(key, value),
    removeItem: (key) => storageMap.delete(key),
  };
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    return new Response(JSON.stringify({
      ok: true,
      generatedAt: "2026-08-25T10:00:00+09:00",
      data: { token: "preview-session-token", expiresIn: 3600, user: { role: "CLIENT_VIEWER" } },
    }), { status: 200 });
  };

  try {
    const api = createHubApi(
      { endpoint: "https://example.invalid/api", timeoutMs: 3000, credentials: "omit" },
      { sessionStore: createSessionStore(storage) },
    );
    await api.previewSession();
    assert.equal(calls[0].action, "preview_session");
    assert.equal(api.getSession().token, "preview-session-token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("공개 첫 진입은 세션과 최소 bootstrap을 한 요청으로 받는다", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const storageMap = new Map();
  const storage = {
    getItem: (key) => storageMap.get(key) || null,
    setItem: (key, value) => storageMap.set(key, value),
    removeItem: (key) => storageMap.delete(key),
  };
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    return new Response(JSON.stringify({
      ok: true,
      generatedAt: "2026-08-26T09:00:00+09:00",
      data: {
        session: { token: "preview-bootstrap-token", expiresIn: 3600, user: { role: "CLIENT_VIEWER" } },
        bootstrap: {
          currentUser: { userId: "PREVIEW", displayName: "고객사", role: "CLIENT_VIEWER" },
          clients: [{ client_id: "C-1", display_name: "UND", status_code: "ACTIVE" }],
          projects: [{ project_id: "P-1", client_id: "C-1", project_name: "통합 마케팅", status_code: "ACTIVE" }],
          channels: [],
        },
      },
    }), { status: 200 });
  };

  try {
    const api = createHubApi(
      { endpoint: "https://example.invalid/api", timeoutMs: 3000, credentials: "omit" },
      { sessionStore: createSessionStore(storage) },
    );
    const envelope = await api.previewBootstrap();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].action, "preview_bootstrap");
    assert.equal(api.getSession().token, "preview-bootstrap-token");
    assert.equal(envelope.data.clients[0].display_name, "UND");
    assert.equal(envelope.data.token, undefined);
    assert.equal(envelope.data.session, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("공개 첫 총괄은 세션 없이 병렬 조회할 수 있다", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody = null;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      ok: true,
      generatedAt: "2026-08-26T09:00:00+09:00",
      scope: { projectId: "P-1" },
      data: { project: { project_id: "P-1" }, summary: {} },
    }), { status: 200 });
  };

  try {
    const api = createHubApi(
      { endpoint: "https://example.invalid/api", timeoutMs: 3000, credentials: "omit" },
      { sessionStore: createSessionStore(null) },
    );
    const envelope = await api.previewOverview();
    assert.equal(requestBody.action, "preview_overview");
    assert.equal(requestBody.auth, undefined);
    assert.equal(envelope.scope.projectId, "P-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("data source previewBootstrap은 준비 상태와 사용자 정보를 함께 갱신한다", async () => {
  const generatedAt = "2026-08-26T09:00:00+09:00";
  const live = {
    getSession: () => ({ token: "preview-token", user: { role: "CLIENT_VIEWER" } }),
    previewBootstrap: async () => ({ ok: true, generatedAt, data: { clients: [], projects: [] } }),
  };
  const config = { endpoint: "https://example.invalid/api", mode: "live", timeoutMs: 3000, credentials: "omit", hasEndpoint: true, loginEnabled: false };
  const source = createHubDataSource({ config, live });

  await source.previewBootstrap();
  assert.equal(source.getState().phase, "ready");
  assert.equal(source.getState().user.role, "CLIENT_VIEWER");
  assert.equal(source.getState().lastSuccessfulAt, generatedAt);
});

test("live 조회 실패는 데모 데이터로 대체하지 않는다", async () => {
  const failure = new HubApiError("연결 실패", { code: "network_error", retriable: true });
  const live = { getSession: () => ({ token: "x", user: {} }), bootstrap: async () => { throw failure; } };
  const config = { endpoint: "https://example.invalid/api", mode: "auto", timeoutMs: 3000, credentials: "omit", hasEndpoint: true, useDemoOnly: false };
  const source = createHubDataSource({ config, live });

  await assert.rejects(source.bootstrap(), failure);
  assert.equal(source.getState().mode, "live");
  assert.equal(source.getState().phase, "error");
});

test("Sheets 응답을 Pocket 화면 뷰모델로 변환한다", () => {
  const bootstrap = bootstrapViewModel({
    generatedAt: "2026-08-25T10:00:00+09:00",
    data: {
      currentUser: { userId: "U-1", displayName: "포켓", role: "POCKET_MANAGER", organization: "POCKET" },
      clients: [{ client_id: "C-1", display_name: "UND", status_code: "ACTIVE", is_demo: false }],
      projects: [{ project_id: "P-1", client_id: "C-1", project_name: "운영", phase_code: "M1", status_code: "ACTIVE" }],
    },
  });
  assert.equal(bootstrap.clients[0].name, "UND");
  assert.equal(bootstrap.actor.role, "pocket");

  const overview = overviewViewModel({
    generatedAt: "2026-08-25T10:00:00+09:00",
    data: {
      project: { project_id: "P-1", client_id: "C-1", project_name: "운영", phase_code: "M1", status_code: "ACTIVE" },
      summary: { tasks: { total: 4, done: 2, inProgress: 1 }, contents: { total: 2, published: 1 }, approvals: { pending: 1 } },
      phases: [{ code: "M1", count: 4 }],
      workstreams: [{ code: "MKT", count: 4 }],
      recentActivity: [],
    },
  }, bootstrap.projects["P-1"]);
  assert.equal(overview.project.metrics[0].value, "4건");

  const taskPage = tasksViewModel({
    generatedAt: "2026-08-25T10:00:00+09:00",
    data: {
      totalMatching: 2,
      project: { project_id: "P-1", phase_code: "M1", start_date: "2026-09-01", end_date: "2026-11-30", row_version: 7 },
      publishing: {
        phases: [{
          phase_code: "M1",
          targets: { long_form: 2, short_form: 10, instagram: 10, blog: 4 },
          actuals: { long_form: 1, short_form: 3, instagram: 2, blog: 1 },
        }],
      },
      members: [{
        user_id: "USR-POCKET-1",
        display_name: "포켓 담당자",
        organization_code: "POCKET",
        role_code: "POCKET_EDITOR",
        permission_code: "EDIT",
      }],
      items: [{
        task_id: "T-1",
        source_task_id: "M1-VID-01",
        title: "촬영",
        phase_code: "M1",
        workstream_code: "VID",
        category_code: "YOUTUBE",
        status_code: "IN_PROGRESS",
        priority_code: "HIGH",
        plan_week: 2,
        contract_linked: true,
        customer_status_text: "촬영 일정 확인 중",
        schedule_dates_json: '["2026-09-02","2026-09-04"]',
        overdue_hold_resolved_at: "2026-09-06T16:00:00Z",
        progress_percent: 35,
        completion_url: "https://example.com/result",
        remarks: "9월 촬영",
        assignee_user_id: "USR-POCKET-1",
        sort_order: 20,
        created_at: "2026-09-03T09:15:00+09:00",
        row_version: 4,
      }, {
        task_id: "T-2",
        title: "자료 취합",
        phase_code: "P0",
        workstream_code: "MKT",
        status_code: "TODO",
        sort_order: 10,
        row_version: 1,
      }],
    },
  });
  assert.deepEqual(taskPage.items.map((item) => item.id), ["T-2", "T-1"]);
  const trackedTask = taskPage.items.find((item) => item.id === "T-1");
  assert.equal(trackedTask.status, "진행");
  assert.equal(trackedTask.stream, "영상");
  assert.equal(trackedTask.sourceTaskId, "M1-VID-01");
  assert.equal(trackedTask.planWeek, 2);
  assert.equal(trackedTask.contractLinked, true);
  assert.equal(trackedTask.customerStatus, "촬영 일정 확인 중");
  assert.deepEqual(trackedTask.scheduleDates, ["2026-09-02", "2026-09-04"]);
  assert.equal(trackedTask.overdueHoldResolvedAt, "2026-09-06T16:00:00Z");
  assert.equal(trackedTask.progressPercent, 35);
  assert.equal(trackedTask.completionUrl, "https://example.com/result");
  assert.equal(trackedTask.remarks, "9월 촬영");
  assert.equal(trackedTask.createdAt, "2026-09-03T09:15:00+09:00");
  assert.equal(taskPage.members[0].userId, "USR-POCKET-1");
  assert.equal(taskPage.members[0].displayName, "포켓 담당자");
  assert.equal(taskPage.members[0].organization, "포켓컴퍼니");
  assert.equal(taskPage.items[0].status, "미착수");
  assert.equal(taskPage.project.startDate, "2026-09-01");
  assert.equal(taskPage.project.rowVersion, 7);
  assert.equal(taskPage.publishing.phases[0].target.total, 26);
  assert.equal(taskPage.publishing.phases[0].actual.total, 7);
});

test("업무 뷰모델은 개인 assignee와 별개로 담당 조직 코드를 고정 라벨로 보존한다", () => {
  const taskPage = tasksViewModel({
    data: {
      items: [
        { task_id: "T-1", title: "포켓 업무", responsible_org_code: "POCKET", assignee_user_id: "USR-1" },
        { task_id: "T-2", title: "NS 업무", responsible_org_code: "NS", assignee_user_id: "USR-2" },
        { task_id: "T-3", title: "고객 업무", responsible_org_code: "CLIENT", assignee_user_id: "USR-3" },
      ],
    },
  });

  assert.deepEqual(
    taskPage.items.map((task) => [task.responsibleOrgCode, task.responsibleOrg]),
    [["POCKET", "포켓"], ["NS", "NS"], ["CLIENT", "고객사"]],
  );
});

test("업무 활동 뷰모델은 제목, 행위자, 동작, 변경값을 보존한다", () => {
  const activity = activityListViewModel({
    generatedAt: "2026-08-26T11:00:00+09:00",
    data: {
      items: [{
        event_id: "EVT-1",
        entity_type: "TASK",
        entity_id: "T-1",
        task_title: "촬영 일정 확정",
        actor_display_name: "홍길동",
        action_code: "UPDATED",
        summary: "업무가 수정됨",
        changes: [
          { field: "status_code", label: "상태", before: "진행", after: "완료" },
          { field: "responsible_org_code", label: "담당", before: "NS", after: "포켓" },
        ],
        created_at: "2026-08-26T10:30:00+09:00",
      }],
    },
  });

  assert.deepEqual(activity.items[0], {
    id: "EVT-1",
    type: "task",
    entityId: "T-1",
    taskTitle: "촬영 일정 확정",
    title: "업무가 수정됨",
    actionCode: "UPDATED",
    action: "수정",
    actor: "홍길동",
    userInitiated: true,
    changes: [
      { field: "status_code", label: "상태", before: "진행", after: "완료" },
      { field: "responsible_org_code", label: "담당", before: "NS", after: "포켓" },
    ],
    createdAt: "2026-08-26T10:30:00+09:00",
    meta: activity.items[0].meta,
    internalMeta: "활동로그",
  });
});

test("업무 활동 뷰모델은 actor_name 별칭과 비어 있는 변경 목록을 허용한다", () => {
  const activity = activityListViewModel({
    data: {
      items: [{
        event_id: "EVT-2",
        entity_type: "task",
        entity_id: "T-2",
        task_title: "자료 취합",
        actor_name: "운영자",
        action_code: "CREATED",
        created_at: "2026-08-26T09:00:00+09:00",
      }],
    },
  });

  assert.equal(activity.items[0].actor, "운영자");
  assert.equal(activity.items[0].userInitiated, true);
  assert.equal(activity.items[0].action, "추가");
  assert.deepEqual(activity.items[0].changes, []);
});

test("세부 로그 뷰모델은 불완전한 시스템 업무 이력도 원본 감사 정보로 보존한다", () => {
  const activity = activityListViewModel({
    data: {
      items: [{
        event_id: "EVT-INCOMPLETE",
        entity_type: "TASK",
        entity_id: "TSK-UND-P0-MKT-1",
        action_code: "UPDATED",
        created_at: "2026-08-26T18:12:00+09:00",
      }, {
        event_id: "EVT-COMPLETE",
        entity_type: "TASK",
        entity_id: "TSK-UND-P0-MKT-2",
        task_title: "콘텐츠 일정 조정",
        actor_display_name: "포켓",
        action_code: "UPDATED",
        changes: [{ field: "due_date", label: "마감일", before: "2026-08-28", after: "2026-08-30" }],
        created_at: "2026-08-26T18:13:00+09:00",
      }],
    },
  });

  assert.deepEqual(activity.items.map((item) => item.id), ["EVT-INCOMPLETE", "EVT-COMPLETE"]);
  assert.equal(activity.items[0].userInitiated, false);
});

test("완료 상태로 바뀐 업무 로그는 수정 대신 완료 동작으로 분류한다", () => {
  const activity = activityListViewModel({
    data: {
      items: [{
        event_id: "EVT-3",
        entity_type: "TASK",
        entity_id: "T-3",
        task_title: "최종 검수",
        actor_display_name: "운영자",
        action_code: "UPDATED",
        changes: [
          { field: "status_code", label: "상태", before: "IN_PROGRESS", after: "DONE" },
          { field: "responsible_org_code", label: "담당 조직", before: "POCKET", after: "CLIENT" },
        ],
        created_at: "2026-08-26T12:00:00+09:00",
      }],
    },
  });

  assert.equal(activity.items[0].action, "완료");
});

test("업무 로그 변경값의 상태·담당 조직 코드를 화면 라벨로 변환한다", () => {
  const activity = activityListViewModel({
    data: {
      items: [{
        event_id: "EVT-4",
        entity_type: "TASK",
        entity_id: "T-4",
        action_code: "UPDATED",
        changes: [
          { field: "status_code", label: "상태", before: "IN_PROGRESS", after: "DONE" },
          { field: "responsible_org_code", label: "담당 조직", before: "POCKET", after: "CLIENT" },
          { field: "schedule_dates_json", label: "간트 일정", before: "[]", after: '["2026-09-01","2026-09-03"]' },
          { field: "visibility_code", before: "CLIENT", after: "PROJECT_TEAM" },
        ],
      }],
    },
  });

  assert.deepEqual(activity.items[0].changes, [
    { field: "status_code", label: "상태", before: "진행", after: "완료" },
    { field: "responsible_org_code", label: "담당 조직", before: "포켓", after: "고객사" },
    { field: "schedule_dates_json", label: "간트 일정", before: "일정 없음", after: "2일 · 2026-09-01~2026-09-03" },
    { field: "visibility_code", label: "고객 공개 범위", before: "고객 공개", after: "고객 숨김" },
  ]);
});

test("project_snapshot을 탭별 캐시 뷰모델로 분해한다", () => {
  const views = workspaceViewModel({
    generatedAt: "2026-08-26T11:00:00+09:00",
    data: {
      plan: { plan: { plan_id: "PLAN-1", title: "고객 공유 계획" }, sections: [] },
      internalPlan: { plan: { plan_id: "PLAN-2", title: "내부 실행 계획" }, sections: [] },
      tasks: { totalMatching: 1, items: [{ task_id: "T-1", title: "업무", status_code: "IN_PROGRESS" }] },
      contents: { totalMatching: 1, items: [{ content_id: "C-1", title: "콘텐츠", status_code: "PLANNED" }] },
      performance: { definitions: [], actuals: [], channels: [] },
      tracking: {
        range: { start: "2026-06-01", end: "2026-08-27" },
        execution: { total: 12, done: 7 },
        totals: { impressions: 1000, clicks: 44, inquiries: 5 },
        channels: [{ channel_code: "INSTAGRAM", label: "Instagram", clicks: 44, inquiries: 5 }],
      },
      files: { totalMatching: 1, items: [{ file_id: "F-1", title: "자료" }] },
      activity: { items: [{ event_id: "E-1", summary: "자료 변경", created_at: "2026-08-26T10:00:00+09:00" }] },
    },
  });

  assert.deepEqual(Object.keys(views).sort(), ["content", "files", "performance", "plan-client", "plan-internal", "tasks", "tracking"]);
  assert.equal(views["plan-client"].id, "PLAN-1");
  assert.equal(views["plan-internal"].id, "PLAN-2");
  assert.equal(views.tasks.items[0].id, "T-1");
  assert.equal(views.content.items[0].id, "C-1");
  assert.equal(views.files.files.items[0].id, "F-1");
  assert.equal(views.files.activities.items[0].id, "E-1");
  assert.equal(views.tracking.totals.impressions, 1000);
  assert.equal(views.tracking.channels[0].inquiries, 5);
});

test("성과 추적 뷰모델은 원장 숫자와 미측정 KPI를 구분한다", () => {
  const tracking = performanceTrackingViewModel({
    data: {
      totals: { spend: "120000", video_views: "37", inquiries: "3" },
      goals: [
        { kpi_id: "K-1", metric_name: "문의", target_value: "10", actual_value: "3", unit_code: "COUNT" },
        { kpi_id: "K-2", metric_name: "매출", target_value: "1000000", actual_value: null, unit_code: "KRW" },
      ],
    },
  });

  assert.equal(tracking.totals.spend, 120000);
  assert.equal(tracking.totals.videoViews, 37);
  assert.equal(tracking.goals[0].value, 3);
  assert.equal(tracking.goals[1].value, null);
  assert.equal(tracking.dataAvailable, false);
});
