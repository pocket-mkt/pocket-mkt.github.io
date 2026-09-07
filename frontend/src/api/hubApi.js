import { HubApiError } from "./errors.js";
import { createHttpClient } from "./httpClient.js";
import { createSessionStore } from "./session.js";

export const READ_ACTIONS = Object.freeze({
  bootstrap: "bootstrap",
  workspace: "project_snapshot",
  overview: "project_overview",
  plan: "project_plan",
  tasks: "tasks",
  dailyMeetings: "daily_meetings",
  contents: "contents",
  tracking: "performance_tracking",
  performance: "performance",
  files: "files",
  activity: "activity",
  permissions: "access_admin",
  credentials: "project_credentials",
});

function scopeQuery(params = {}) {
  return {
    clientId: params.clientId,
    projectId: params.projectId,
    cursor: params.cursor,
    limit: params.limit,
    startDate: params.startDate,
    endDate: params.endDate,
    query: params.query,
    status: params.status,
    channel: params.channel,
    entityType: params.entityType,
    planType: params.planType,
    initialView: params.initialView,
    permissionPage: params.permissionPage,
  };
}

export function createMutationId(prefix = "mut") {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}_${uuid}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

export function createHubApi(config, options = {}) {
  const http = createHttpClient(config);
  const sessionStore = options.sessionStore || createSessionStore();
  let batchMutationSupported = null;

  function sessionToken() {
    const session = sessionStore.read();
    if (!session?.token) {
      throw new HubApiError("로그인이 필요합니다.", {
        code: "unauthorized",
        status: 401,
        retriable: false,
      });
    }
    return session.token;
  }

  async function login(credentials = {}) {
    const response = await http.request("login", {
      body: {
        account: String(credentials.account || credentials.email || "").trim(),
        accessCode: String(credentials.accessCode || ""),
        includeBootstrap: true,
        initialView: credentials.initialView,
      },
      signal: credentials.signal,
    });
    const payload = response.data || {};
    const session = payload.session || payload;
    sessionStore.write(session);
    return {
      ...response,
      data: session,
      bootstrap: payload.bootstrap ? { ...response, data: payload.bootstrap } : null,
    };
  }

  async function previewSession(options = {}) {
    const response = await http.request("preview_session", { signal: options.signal });
    sessionStore.write(response.data);
    return response;
  }

  async function previewBootstrap(options = {}) {
    const response = await http.request("preview_bootstrap", { signal: options.signal });
    const payload = response.data || {};
    const session = payload.session || payload;
    sessionStore.write(session);

    // The optimized endpoint returns the session and the minimum navigation
    // bootstrap in one round trip. Keep a narrow flat-response compatibility
    // path so a staged Apps Script deployment does not strand the client.
    const bootstrap = payload.bootstrap?.data || payload.bootstrap || payload;
    return {
      ...response,
      generatedAt: payload.bootstrap?.generatedAt || response.generatedAt,
      data: bootstrap,
    };
  }

  async function previewOverview(options = {}) {
    return http.request("preview_overview", {
      body: { projectId: options.projectId },
      signal: options.signal,
    });
  }

  async function read(resource, params = {}) {
    const action = READ_ACTIONS[resource];
    if (!action) {
      throw new HubApiError("지원하지 않는 조회 요청입니다.", {
        code: "unsupported_action",
        action: resource,
        retriable: false,
      });
    }

    return http.request(action, {
      body: {
        auth: { sessionToken: sessionToken() },
        ...scopeQuery(params),
      },
      signal: params.signal,
    });
  }

  async function mutate(input = {}) {
    const mutationId = input.mutationId || createMutationId();
    const mutation = input.mutation;

    if (!mutation || typeof mutation !== "object") {
      throw new HubApiError("저장할 변경 내용이 없습니다.", {
        code: "missing_mutation",
        action: "mutate",
        retriable: false,
      });
    }

    const requestOptions = {
      signal: input.signal,
      body: {
        auth: { sessionToken: sessionToken() },
        mutation: {
          mutationId,
          entityType: mutation.entityType || mutation.entity,
          operation: String(mutation.operation || "").toUpperCase(),
          projectId: input.projectId ?? mutation.projectId ?? null,
          id: mutation.id ?? null,
          expectedRowVersion: input.expectedRowVersion ?? mutation.expectedRowVersion ?? null,
          fields: mutation.fields || mutation.values || {},
        },
      },
    };
    try {
      return await http.request("mutate", requestOptions);
    } catch (error) {
      if (!error?.retriable || input.signal?.aborted) throw error;
      // Reuse the exact mutation id. If the first request committed but its
      // response was lost, the server returns the indexed canonical result.
      await new Promise((resolve) => setTimeout(resolve, 250 + Math.random() * 250));
      return http.request("mutate", requestOptions);
    }
  }

  async function mutateBatch(input = {}) {
    const mutations = Array.isArray(input.mutations) ? input.mutations : [];
    if (!mutations.length || mutations.length > 40) {
      throw new HubApiError("한 번에 저장할 업무 변경은 1~40건이어야 합니다.", {
        code: "invalid_batch_size",
        action: "mutate_batch",
        retriable: false,
      });
    }
    const normalizedMutations = mutations.map((mutation) => {
      if (!mutation || typeof mutation !== "object") {
        throw new HubApiError("저장할 변경 내용이 올바르지 않습니다.", {
          code: "missing_mutation",
          action: "mutate_batch",
          retriable: false,
        });
      }
      return {
        mutationId: mutation.mutationId || createMutationId(),
        entityType: mutation.entityType || mutation.entity,
        operation: String(mutation.operation || "").toUpperCase(),
        projectId: input.projectId ?? mutation.projectId ?? null,
        id: mutation.id ?? null,
        expectedRowVersion: mutation.expectedRowVersion ?? null,
        fields: mutation.fields || mutation.values || {},
      };
    });
    const requestOptions = {
      signal: input.signal,
      body: {
        auth: { sessionToken: sessionToken() },
        projectId: input.projectId ?? null,
        mutations: normalizedMutations,
      },
    };
    const runSequentialFallback = async () => {
      const responses = [];
      for (const mutation of normalizedMutations) {
        responses.push(await mutate({
          projectId: input.projectId,
          mutationId: mutation.mutationId,
          signal: input.signal,
          mutation,
        }));
      }
      const last = responses[responses.length - 1];
      return {
        ...last,
        data: { batch: true, fallback: true, results: responses.map((response) => response.data) },
      };
    };

    // A one-row Gantt toggle is a normal task update. Sending mutate_batch
    // first only adds a failed Apps Script round trip on the deployed v41 API.
    if (normalizedMutations.length === 1 || batchMutationSupported === false) {
      return runSequentialFallback();
    }

    const sendBatch = async () => {
      try {
        const result = await http.request("mutate_batch", requestOptions);
        batchMutationSupported = true;
        return result;
      } catch (error) {
        // Remember the capability for this browser API instance. Before v43,
        // probing the unsupported route on every drag doubled save latency.
        if (error?.code === "invalid_request") {
          batchMutationSupported = false;
          return runSequentialFallback();
        }
        throw error;
      }
    };

    try {
      return await sendBatch();
    } catch (error) {
      if (!error?.retriable || input.signal?.aborted) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 + Math.random() * 250));
      return sendBatch();
    }
  }

  async function accessAdminMutate(input = {}) {
    return http.request("access_admin_mutate", {
      signal: input.signal,
      body: {
        auth: { sessionToken: sessionToken() },
        operation: input.operation || input.account?.operation || "UPSERT",
        account: input.account || input.fields || {},
      },
    });
  }

  return Object.freeze({
    read,
    login,
    previewSession,
    previewBootstrap,
    previewOverview,
    logout: () => sessionStore.clear(),
    getSession: () => sessionStore.read(),
    bootstrap: (params) => read("bootstrap", params),
    workspace: (params) => read("workspace", params),
    overview: (params) => read("overview", params),
    plan: (params) => read("plan", params),
    tasks: (params) => read("tasks", params),
    dailyMeetings: (params) => read("dailyMeetings", params),
    contents: (params) => read("contents", params),
    tracking: (params) => read("tracking", params),
    performance: (params) => read("performance", params),
    files: (params) => read("files", params),
    activity: (params) => read("activity", params),
    permissions: (params) => read("permissions", params),
    credentials: (params) => read("credentials", params),
    accessAdminMutate,
    mutate,
    mutateBatch,
  });
}
