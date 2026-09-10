import { readApiConfig } from "./config.js";
import { HubApiError, OfflineMutationError, publicApiError } from "./errors.js";
import { createHubApi, READ_ACTIONS } from "./hubApi.js";
import { readSupabaseConfig } from "../supabase/config.js";
import { createSupabaseHybridApi } from "../supabase/hybridApi.js";
import { createDiagnostics } from "./diagnostics.js";

const INITIAL_STATE = Object.freeze({
  mode: "initializing",
  phase: "idle",
  action: null,
  error: null,
  fallbackReason: null,
  lastSuccessfulAt: null,
});

export function createHubDataSource(options = {}) {
  const diagnostics = createDiagnostics(options.diagnosticsOptions);
  let sessionEpoch = 0;
  const assertSessionEpoch = epoch => {
    if (epoch !== sessionEpoch) throw new HubApiError("이전 세션의 요청이 취소되었습니다.", { code: "aborted", retriable: false });
  };
  const runtimeEnv = options.env ?? import.meta.env;
  const storageConfig = options.storageConfig || readSupabaseConfig(runtimeEnv);
  let config;
  let live;

  if (storageConfig.enabled) {
    if (!storageConfig.configured) {
      throw new HubApiError("Supabase 공개 연결 설정이 없습니다.", {
        code: "missing_supabase_config",
        action: "initialize",
        retriable: false,
      });
    }
    // Supabase is the primary store, but the hybrid adapter still needs the
    // deployed Apps Script endpoint for the pages that have not moved yet and
    // for the background legacy session. Never erase the validated build-time
    // endpoint here: doing so makes createSupabaseHybridApi fail before the
    // login screen can render.
    const baseConfig = options.config || readApiConfig(runtimeEnv);
    config = Object.freeze({
      ...baseConfig,
      dataBackend: "supabase",
      hasEndpoint: true,
    });
    live = options.supabaseLive || createSupabaseHybridApi(storageConfig, {
      ...options,
      env: runtimeEnv,
      legacyConfig: baseConfig,
    });
  } else {
    const baseConfig = options.config || readApiConfig(runtimeEnv);
    config = Object.freeze({ ...baseConfig, dataBackend: "sheets" });
    live = config.hasEndpoint ? (options.live || createHubApi(config, options)) : null;
  }
  const listeners = new Set();
  let state = {
    ...INITIAL_STATE,
    mode: "live",
    user: live?.getSession?.()?.user || null,
  };

  function emit(next) {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener(state));
  }

  function remember(next) {
    state = { ...state, ...next };
  }

  function getState() {
    return { ...state };
  }

  function subscribe(listener) {
    listeners.add(listener);
    listener(getState());
    return () => listeners.delete(listener);
  }

  function rememberWriteFailure(error) {
    const safeError = publicApiError(error);
    if (safeError.code === "unauthorized") {
      live?.logout?.();
      emit({ phase: "error", action: null, error: safeError, user: null });
      return;
    }
    // The page-level mutation caller owns rollback and error rendering.
    // Broadcasting an ordinary write failure here rerendered the whole app
    // and made an intact project look like its read request had failed.
    remember({ action: null, error: safeError });
  }

  async function load(resource, params = {}) {
    const epoch = sessionEpoch;
    if (!Object.prototype.hasOwnProperty.call(READ_ACTIONS, resource)) {
      throw new HubApiError("지원하지 않는 데이터 화면입니다.", {
        code: "unsupported_action",
        action: resource,
        retriable: false,
      });
    }

    if (!live) throw new HubApiError("API 주소가 설정되지 않았습니다.", { code: "missing_api_url", action: resource, retriable: false });

      try {
        if (typeof live[resource] !== "function") throw new HubApiError("고객용 조회 서버 설정을 확인해 주세요.", { code: "unsupported_action", action: resource, retriable: false });
        const result = await live[resource](params);
        assertSessionEpoch(epoch);
      const nextState = {
        mode: "live",
        phase: "ready",
        action: null,
        error: null,
        fallbackReason: null,
        lastSuccessfulAt: result.generatedAt || new Date().toISOString(),
      };
      // Page components own their loading state. Re-emitting the shared source
      // state for every tab request forced the entire Gantt/table tree to render
      // twice even though none of its data had changed.
      if (state.lastSuccessfulAt) remember(nextState);
      else emit(nextState);
      return result;
    } catch (error) {
      assertSessionEpoch(epoch);
      const safeError = publicApiError(error);
      if (safeError.code === "unauthorized") live?.logout?.();
      emit({
        mode: "live",
        phase: "error",
        action: null,
        error: safeError,
        user: live?.getSession?.()?.user || null,
      });
      throw error;
    }
  }

  async function mutate(input) {
    const epoch = sessionEpoch;
    if (!live) {
      const error = new OfflineMutationError();
      emit({ phase: "error", action: null, error: publicApiError(error) });
      throw error;
    }

    try {
      const result = await live.mutate(input);
      assertSessionEpoch(epoch);
      remember({
        mode: "live",
        phase: "ready",
        action: null,
        error: null,
        lastSuccessfulAt: result.generatedAt || new Date().toISOString(),
      });
      return result;
    } catch (error) {
      assertSessionEpoch(epoch);
      rememberWriteFailure(error);
      throw error;
    }
  }

  async function mutateBatch(input) {
    const epoch = sessionEpoch;
    if (!live) {
      const error = new OfflineMutationError();
      emit({ phase: "error", action: null, error: publicApiError(error) });
      throw error;
    }
    try {
      const result = await live.mutateBatch(input);
      assertSessionEpoch(epoch);
      remember({
        mode: "live",
        phase: "ready",
        action: null,
        error: null,
        lastSuccessfulAt: result.generatedAt || new Date().toISOString(),
      });
      return result;
    } catch (error) {
      assertSessionEpoch(epoch);
      rememberWriteFailure(error);
      throw error;
    }
  }

  async function accessAdminMutate(input) {
    const epoch = sessionEpoch;
    if (!live) throw new OfflineMutationError();
    try {
      const result = await live.accessAdminMutate(input);
      assertSessionEpoch(epoch);
      remember({ mode: "live", phase: "ready", action: null, error: null, lastSuccessfulAt: result.generatedAt || new Date().toISOString() });
      return result;
    } catch (error) {
      assertSessionEpoch(epoch);
      rememberWriteFailure(error);
      throw error;
    }
  }

  async function domainWrite(method, input) {
    const epoch = sessionEpoch;
    if (!live || typeof live[method] !== "function") throw new OfflineMutationError();
    try {
      const result = await live[method](input);
      assertSessionEpoch(epoch);
      remember({ mode: "live", phase: "ready", action: null, error: null, lastSuccessfulAt: result.generatedAt || new Date().toISOString() });
      return result;
    } catch (error) {
      assertSessionEpoch(epoch);
      rememberWriteFailure(error);
      throw error;
    }
  }

  async function login(credentials) {
    const epoch = ++sessionEpoch;
    if (!live) {
      throw new HubApiError("API 주소가 설정되지 않았습니다.", {
        code: "missing_api_url",
        action: "login",
        retriable: false,
      });
    }
    emit({ phase: "loading", action: "login", error: null });
    try {
      const result = await live.login(credentials);
      assertSessionEpoch(epoch);
      emit({
        mode: "live",
        phase: "ready",
        action: null,
        error: null,
        user: result.data.user,
        lastSuccessfulAt: result.generatedAt || new Date().toISOString(),
      });
      return result;
    } catch (error) {
      assertSessionEpoch(epoch);
      emit({ phase: "error", action: null, error: publicApiError(error), user: null });
      throw error;
    }
  }

  async function previewSession(options = {}) {
    if (!live) {
      throw new HubApiError("API 주소가 설정되지 않았습니다.", {
        code: "missing_api_url",
        action: "preview_session",
        retriable: false,
      });
    }
    emit({ phase: "loading", action: "preview_session", error: null });
    try {
      const result = await live.previewSession(options);
      emit({
        mode: "live",
        phase: "ready",
        action: null,
        error: null,
        user: result.data.user,
        lastSuccessfulAt: result.generatedAt || new Date().toISOString(),
      });
      return result;
    } catch (error) {
      emit({ phase: "error", action: null, error: publicApiError(error), user: null });
      throw error;
    }
  }

  async function previewBootstrap(options = {}) {
    if (!live) {
      throw new HubApiError("API 주소가 설정되지 않았습니다.", {
        code: "missing_api_url",
        action: "preview_bootstrap",
        retriable: false,
      });
    }
    emit({ phase: "loading", action: "preview_bootstrap", error: null });
    try {
      const result = await live.previewBootstrap(options);
      emit({
        mode: "live",
        phase: "ready",
        action: null,
        error: null,
        user: live.getSession()?.user || null,
        lastSuccessfulAt: result.generatedAt || new Date().toISOString(),
      });
      return result;
    } catch (error) {
      emit({ phase: "error", action: null, error: publicApiError(error), user: null });
      throw error;
    }
  }

  async function previewOverview(options = {}) {
    if (!live) {
      throw new HubApiError("API 주소가 설정되지 않았습니다.", {
        code: "missing_api_url",
        action: "preview_overview",
        retriable: false,
      });
    }
    emit({ phase: "loading", action: "preview_overview", error: null });
    try {
      const result = await live.previewOverview(options);
      emit({
        mode: "live",
        phase: "ready",
        action: null,
        error: null,
        lastSuccessfulAt: result.generatedAt || new Date().toISOString(),
      });
      return result;
    } catch (error) {
      emit({ phase: "error", action: null, error: publicApiError(error) });
      throw error;
    }
  }

  function logout() {
    sessionEpoch++;
    diagnostics.clear();
    live?.logout?.();
    emit({ phase: "idle", action: null, error: null, user: null, lastSuccessfulAt: null });
  }

  const api = {
    config,
    getState,
    subscribe,
    login,
    previewSession,
    previewBootstrap,
    previewOverview,
    logout,
    getSession: () => live?.getSession?.() || null,
    load,
    bootstrap: (params) => load("bootstrap", params),
    operationsDashboard: (params) => load("operationsDashboard", params),
    workspace: (params) => load("workspace", params),
    overview: (params) => load("overview", params),
    plan: (params) => load("plan", params),
    tasks: (params) => load("tasks", params),
    clientProgress: (params) => load("clientProgress", params),
    dailyMeetings: (params) => load("dailyMeetings", params),
    contents: (params) => load("contents", params),
    tracking: (params) => load("tracking", params),
    performance: (params) => load("performance", params),
    files: (params) => load("files", params),
    activity: (params) => load("activity", params),
    permissions: (params) => load("permissions", params),
    credentials: (params) => load("credentials", params),
    blog: (params) => load('blog',params),
    saveBlog: (params) => domainWrite('saveBlog',params),
    saveBlogRank: (params) => domainWrite('saveBlogRank',params),
    revealCredential: (params) => domainWrite("revealCredential", params),
    accessAdminMutate,
    createProject: (input) => domainWrite("createProject", input),
    importQuoteTasks: (input) => domainWrite("importQuoteTasks", input),
    mutate,
    mutateBatch,
  };
  for (const name of ["login", "bootstrap", "operationsDashboard", "workspace", "overview", "plan", "tasks", "clientProgress", "dailyMeetings", "contents", "tracking", "performance", "files", "activity", "permissions", "credentials", "accessAdminMutate", "createProject", "importQuoteTasks", "mutate", "mutateBatch"]) {
    api[name] = diagnostics.wrap(name, api[name]);
  }
  api.getDiagnostics = diagnostics.summary;
  const measuredLogin = api.login;
  api.login = (...args) => { diagnostics.clear(); return measuredLogin(...args); };
  return Object.freeze(api);
}
