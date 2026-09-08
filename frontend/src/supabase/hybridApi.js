import { readApiConfig } from "../api/config.js";
import { HubApiError } from "../api/errors.js";
import { createHubApi } from "../api/hubApi.js";
import { createSessionStore } from "../api/session.js";
import { getSupabaseClient } from "./client.js";
import { createSupabaseAccessAdmin } from "./accessAdmin.js";
import { createSupabaseCoreDomainApi } from "./coreDomainApi.js";
import { createSupabaseTaskReader, createClientProgressReader } from "./taskRead.js";
import { createSupabaseTaskActivityReader } from "./taskActivityRead.js";
import { createSupabaseTaskBatchMutator, createSupabaseTaskMutator } from "./taskMutation.js";
import { createSupabasePlanReader } from "./planRead.js";
import { createSupabaseCredentialLedger } from "./credentialLedger.js";

function bridgeError(payload, status) {
  const code = String(payload?.error?.code || "auth_bridge_unavailable");
  return new HubApiError(
    code === "invalid_credentials"
      ? "아이디 또는 비밀번호를 확인해 주세요."
      : "로그인 서버에 연결하지 못했습니다.",
    {
      code: code === "invalid_credentials" ? "unauthorized" : code,
      status,
      action: "login",
      retriable: status >= 500 || status === 429,
    },
  );
}

async function fetchBridge(config, credentials = {}, lifecycleSignal) {
  const controller = new AbortController();
  const signals = [credentials.signal, lifecycleSignal].filter(Boolean);
  const abort = () => controller.abort(signals.find((signal) => signal.aborted)?.reason);
  signals.forEach((signal) => {
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
  const timer = setTimeout(() => controller.abort("timeout"), 45_000);
  try {
    const response = await fetch(`${config.url}/functions/v1/hub-auth-bridge`, {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        apikey: config.publishableKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        account: String(credentials.account || credentials.email || "").trim(),
        accessCode: String(credentials.accessCode || ""),
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true || !payload?.data?.session || !payload?.data?.legacy?.session) {
      throw bridgeError(payload, response.status);
    }
    return payload;
  } catch (error) {
    if (error instanceof HubApiError) throw error;
    const cancelled = signals.some((signal) => signal.aborted);
    throw new HubApiError(
      cancelled ? "로그인 요청이 취소되었습니다." : controller.signal.aborted ? "로그인 서버 응답 시간이 초과되었습니다." : "로그인 서버에 연결하지 못했습니다.",
      { code: cancelled ? "aborted" : controller.signal.aborted ? "timeout" : "network_error", action: "login", retriable: !cancelled, cause: error },
    );
  } finally {
    clearTimeout(timer);
    signals.forEach((signal) => signal.removeEventListener("abort", abort));
  }
}

function entityType(input = {}) {
  return String(input.mutation?.entityType || input.mutation?.entity || "").trim().toUpperCase();
}

export function summarizeSupabaseTasks(items = []) {
  const active = items.filter((item) => !item?.archived_at);
  const statusCount = (codes) => active.filter((item) => codes.includes(String(item?.status_code || "").toUpperCase())).length;
  const groupCounts = (field) => Object.entries(active.reduce((groups, item) => {
    const code = String(item?.[field] || "").trim().toUpperCase();
    if (code) groups[code] = (groups[code] || 0) + 1;
    return groups;
  }, {})).map(([code, count]) => ({ code, count }));

  return {
    summary: {
      total: active.length,
      done: statusCount(["DONE"]),
      inProgress: statusCount(["IN_PROGRESS", "INTERNAL_REVIEW", "WAITING_CLIENT", "REVISION"]),
      blocked: statusCount(["BLOCKED"]),
    },
    phases: groupCounts("phase_code"),
    workstreams: groupCounts("workstream_code"),
  };
}

export function legacyPermissionMirrorInput(input = {}) {
  const account = input.account || input.fields || {};
  const { membershipId: _membershipId, membership_id: _membershipIdSnake, ...legacyAccount } = account;
  return {
    ...input,
    account: legacyAccount,
    fields: undefined,
  };
}

export function createSupabaseHybridApi(storageConfig, options = {}) {
  const env = options.env ?? import.meta.env;
  const sessionStore = options.sessionStore || createSessionStore();
  const legacySessionStore = options.legacySessionStore || createSessionStore(undefined, "pocket_marketing_hub_legacy_session_v1");
  const sheets = createHubApi(options.legacyConfig || readApiConfig(env), { ...options, sessionStore: legacySessionStore });
  const client = options.supabaseClient || getSupabaseClient(env);
  const core = createSupabaseCoreDomainApi(client);
  const accessAdmin = createSupabaseAccessAdmin(client);
  const readTasks = createSupabaseTaskReader(client, options);
  const readClientProgress = createClientProgressReader(client, options);
  const readTaskActivity = createSupabaseTaskActivityReader(client, options);
  const readPlan = createSupabasePlanReader(client, options);
  const mutateTask = createSupabaseTaskMutator(client, options);
  const mutateTasksBatch = createSupabaseTaskBatchMutator(client, options);
  const credentialLedger = createSupabaseCredentialLedger(client);
  const projectIds = new Map();
  let legacyLoginPromise = null;
  let sessionGeneration = 0;
  let bridgeController = null;

  function resetSessionWork() {
    sessionGeneration += 1;
    bridgeController?.abort("session_changed");
    bridgeController = null;
    legacyLoginPromise = null;
    legacySessionStore.clear();
    projectIds.clear();
  }

  function assertCurrentSession(generation, signal) {
    if (generation !== sessionGeneration || signal?.aborted) {
      throw new HubApiError("로그인 요청이 취소되었습니다.", { code: "aborted", action: "login", retriable: false });
    }
  }

  function rememberProjectMappings(envelope) {
    (envelope?.data?.projects || []).forEach((project) => {
      const legacyId = String(project.project_id || "").trim();
      const numericId = String(project.supabase_id || "").trim();
      if (legacyId && numericId) projectIds.set(legacyId, numericId);
    });
  }

  function accountEmail(value) {
    const normalized = String(value || "").trim().toLowerCase();
    return normalized.includes("@") ? normalized : `${normalized}@hub.local`;
  }

  function publicUser(profile = {}) {
    return {
      userId: profile.userId,
      displayName: profile.displayName,
      role: profile.role,
      organization: profile.organization,
    };
  }

  function mainSessionPayload(authSession, profile) {
    // Supabase refreshes its access token independently. This tab-local shell
    // only decides whether to render the signed-in UI, so keep it for a workday
    // and let requireAuth() fail closed if the actual refresh session disappears.
    const expiresIn = Math.max(12 * 60 * 60, Number(authSession?.expires_at || 0) - Math.floor(Date.now() / 1000));
    return { token: authSession.access_token, expiresIn, user: publicUser(profile) };
  }

  function warmLegacySession(credentials, generation) {
    const controller = new AbortController();
    bridgeController = controller;
    const pending = fetchBridge(storageConfig, credentials, controller.signal)
      .then((payload) => {
        assertCurrentSession(generation, credentials.signal);
        legacySessionStore.write(payload.data.legacy.session);
        return payload.data.legacy.session;
      })
      .catch(() => null)
      .finally(() => {
        if (legacyLoginPromise === pending) legacyLoginPromise = null;
        if (bridgeController === controller) bridgeController = null;
      });
    legacyLoginPromise = pending;
  }

  async function requireLegacySession() {
    const generation = sessionGeneration;
    if (legacySessionStore.read()) return;
    if (legacyLoginPromise) await legacyLoginPromise;
    assertCurrentSession(generation);
    if (!legacySessionStore.read()) {
      throw new HubApiError("이 화면의 기존 Sheets 연결 세션이 만료되었습니다. 다시 로그인해 주세요.", {
        code: "legacy_session_required",
        action: "legacy_sheet",
        retriable: false,
      });
    }
  }

  const legacyRead = (method) => async (params = {}) => {
    const generation = sessionGeneration;
    await requireLegacySession();
    assertCurrentSession(generation, params.signal);
    return sheets[method](params);
  };

  async function requireAuth() {
    const { data, error } = await client.auth.getSession();
    if (error || !data.session) {
      sessionStore.clear();
      throw new HubApiError("로그인이 필요합니다.", {
        code: "unauthorized",
        status: 401,
        action: "supabase_session",
        retriable: false,
        cause: error || undefined,
      });
    }
    return data.session;
  }

  async function resolveProjectId(value) {
    const key = String(value ?? "").trim();
    if (/^[1-9]\d*$/.test(key)) return key;
    if (projectIds.has(key)) return projectIds.get(key);
    await requireAuth();
    const { data, error } = await client
      .from("projects")
      .select("id,legacy_id")
      .eq("legacy_id", key)
      .is("archived_at", null)
      .maybeSingle();
    if (error || !data?.id) {
      throw new HubApiError("Supabase 프로젝트 연결 정보를 찾지 못했습니다.", {
        code: error?.code || "project_mapping_missing",
        action: "resolve_project",
        retriable: false,
        cause: error || undefined,
      });
    }
    const id = String(data.id);
    projectIds.set(key, id);
    return id;
  }

  async function login(credentials = {}) {
    resetSessionWork();
    sessionStore.clear();
    const generation = sessionGeneration;
    assertCurrentSession(generation, credentials.signal);
    const email = accountEmail(credentials.account || credentials.email);
    let authSession;
    let usedBridge = false;
    const direct = await client.auth.signInWithPassword({ email, password: String(credentials.accessCode || "") });
    assertCurrentSession(generation, credentials.signal);
    const authStatus = Number(direct.error?.status || 0);
    if (direct.error && (authStatus === 429 || authStatus >= 500 || direct.error.name === "AuthRetryableFetchError")) {
      // An infrastructure failure is not evidence of an unmigrated account.
      // Do not turn it into a second, up-to-45-second legacy login attempt.
      throw new HubApiError(authStatus === 429 ? "로그인 요청이 많습니다. 잠시 후 다시 시도해 주세요." : "로그인 서버에 연결하지 못했습니다.", {
        code: authStatus === 429 ? "rate_limited" : "network_error", status: authStatus || null,
        action: "login", retriable: true, cause: direct.error,
      });
    }
    if (direct.error || !direct.data?.session) {
      const controller = new AbortController();
      bridgeController = controller;
      const payload = await fetchBridge(storageConfig, credentials, controller.signal);
      assertCurrentSession(generation, credentials.signal);
      const { error } = await client.auth.setSession({ access_token: payload.data.session.access_token, refresh_token: payload.data.session.refresh_token });
      assertCurrentSession(generation, credentials.signal);
      if (error) throw bridgeError({ error }, 401);
      authSession = payload.data.session;
      legacySessionStore.write(payload.data.legacy.session);
      usedBridge = true;
    } else {
      authSession = direct.data.session;
    }
    const bootstrap = await core.bootstrap({ signal: credentials.signal });
    assertCurrentSession(generation, credentials.signal);
    const profile = bootstrap.data.currentUser;
    sessionStore.write(mainSessionPayload(authSession, profile));
    projectIds.clear();
    rememberProjectMappings(bootstrap);
    if (!usedBridge) warmLegacySession(credentials, generation);
    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      data: mainSessionPayload(authSession, profile),
      bootstrap,
    };
  }

  async function bootstrap(params = {}) {
    await requireAuth();
    const result = await core.bootstrap(params);
    rememberProjectMappings(result);
    return result;
  }

  async function tasks(params = {}) {
    const projectId = await resolveProjectId(params.projectId);
    return readTasks({ ...params, projectId });
  }

  async function plan(params = {}) {
    const projectId = await resolveProjectId(params.projectId);
    return readPlan({ ...params, projectId });
  }

  async function overview(params = {}) {
    const projectId = await resolveProjectId(params.projectId);
    const [legacyOverview, taskEnvelope] = await Promise.all([
      legacyRead("overview")(params),
      readTasks({ ...params, projectId }),
    ]);
    const taskRollup = summarizeSupabaseTasks(taskEnvelope.data.items);
    return {
      ...legacyOverview,
      generatedAt: taskEnvelope.generatedAt || legacyOverview.generatedAt,
      data: {
        ...(legacyOverview.data || {}),
        summary: {
          ...(legacyOverview.data?.summary || {}),
          tasks: taskRollup.summary,
        },
        phases: taskRollup.phases,
        workstreams: taskRollup.workstreams,
      },
    };
  }

  async function mutate(input = {}) {
    const projectId = await resolveProjectId(input.projectId ?? input.mutation?.projectId);
    const type = entityType(input);
    if (type === "TASK") return mutateTask({ ...input, projectId, mutation: { ...input.mutation, projectId } });
    if (type === "PROJECT_ISSUE") return core.mutateIssue({ ...input, projectId, mutation: { ...input.mutation, projectId } });
    if (type === "DAILY_MEETING") return core.mutateMeeting({ ...input, projectId, mutation: { ...input.mutation, projectId } });
    if (type === "KPI_DEFINITION") return core.mutateKpi({ ...input, projectId, mutation: { ...input.mutation, projectId } });
    if (type === "PROJECT_CREDENTIAL") return credentialLedger.mutate({ ...input, projectId, mutation: { ...input.mutation, projectId } });
    await requireLegacySession();
    return sheets.mutate(input);
  }

  async function mutateBatch(input = {}) {
    const mutations = Array.isArray(input.mutations) ? input.mutations : [];
    if (!mutations.length || mutations.some((mutation) => String(mutation?.entityType || mutation?.entity || "").toUpperCase() !== "TASK")) {
      await requireLegacySession();
      return sheets.mutateBatch(input);
    }
    const projectId = await resolveProjectId(input.projectId);
    return mutateTasksBatch({ ...input, projectId, mutations: mutations.map((mutation) => ({ ...mutation, projectId })) });
  }

  async function accessAdminMutate(input = {}) {
    const generation = sessionGeneration;
    const operation = String(input.operation || input.account?.operation || "UPSERT").toUpperCase();
    let result;
    try {
      result = await accessAdmin.mutate(input);
    } catch (error) {
      if (operation !== "REMOVE_ACCESS" || error?.code !== "not_found") throw error;
      result = { ok: true, generatedAt: new Date().toISOString(), data: { saved: true, removed: true, alreadyRemoved: true } };
    }

    // Supabase is authoritative for account and page permissions. The legacy
    // Sheets copy only supports pages that have not been migrated yet, so a
    // missing/expired Sheets session must never turn a completed Supabase
    // mutation into a visible save failure. Mirror opportunistically without
    // delaying the permission screen.
    void (async () => {
      if (legacyLoginPromise) await legacyLoginPromise;
      if (generation !== sessionGeneration) return;
      if (!legacySessionStore.read()) return;
      try {
        await sheets.accessAdminMutate(legacyPermissionMirrorInput(input));
      } catch (error) {
        console.info("[legacy-permission-sync] skipped", error?.code || error?.message || "unknown_error");
      }
    })();
    return result;
  }

  async function activity(params = {}) {
    if (String(params.entityType || "").toUpperCase() !== "TASK") return legacyRead("activity")(params);
    const projectId = await resolveProjectId(params.projectId);
    return readTaskActivity({ ...params, projectId });
  }

  async function createProject(input = {}) {
    await requireAuth();
    return core.createProject(input);
  }

  async function importQuoteTasks(input = {}) {
    await requireAuth();
    const projectId = await resolveProjectId(input.projectId);
    return core.importQuoteTasks({ ...input, projectId });
  }

  function logout() {
    resetSessionWork();
    sessionStore.clear();
    void client.auth.signOut({ scope: "local" });
  }

  return Object.freeze({
    login,
    logout,
    getSession: () => sessionStore.read(),
    previewSession: sheets.previewSession,
    previewBootstrap: sheets.previewBootstrap,
    previewOverview: sheets.previewOverview,
    bootstrap,
    operationsDashboard: (params = {}) => core.operationsDashboard(params),
    workspace: legacyRead("workspace"),
    overview,
    plan,
    tasks,
    clientProgress: async (params = {}) => readClientProgress({ ...params, projectId: await resolveProjectId(params.projectId) }),
    dailyMeetings: async (params = {}) => core.dailyMeetings({ ...params, projectId: await resolveProjectId(params.projectId) }),
    contents: legacyRead("contents"),
    tracking: legacyRead("tracking"),
    performance: async (params = {}) => core.performance({ ...params, projectId: await resolveProjectId(params.projectId) }),
    credentials: async (params = {}) => credentialLedger.read({ ...params, projectId: await resolveProjectId(params.projectId) }),
    revealCredential: async (params = {}) => credentialLedger.reveal({ ...params, projectId: await resolveProjectId(params.projectId) }),
    files: legacyRead("files"),
    activity,
    permissions: () => accessAdmin.read(),
    createProject,
    importQuoteTasks,
    accessAdminMutate,
    mutate,
    mutateBatch,
  });
}
