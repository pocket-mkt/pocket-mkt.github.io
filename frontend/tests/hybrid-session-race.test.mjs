import assert from "node:assert/strict";
import test from "node:test";
import { createSupabaseHybridApi, needsLegacyPages } from "../src/supabase/hybridApi.js";

test("native-only customers do not send credentials to a background Sheets bridge", () => {
  const bootstrap={data:{currentUser:{role:"CLIENT_VIEWER"},projects:[{allowed_pages:["progress"]}]}};
  assert.equal(needsLegacyPages(bootstrap),false);
  assert.equal(needsLegacyPages({data:{...bootstrap.data,projects:[{allowed_pages:["files"]}]}}),true);
  assert.equal(needsLegacyPages({data:{...bootstrap.data,currentUser:{role:"EXECUTOR_EDITOR"}}}),true);
});

test("retired hidden pages fail explicitly without contacting Sheets", async t => {
  const f=fixture(t);
  await assert.rejects(f.api.contents({}),{code:"unsupported_action"});
  await assert.rejects(f.api.tracking({}),{code:"unsupported_action"});
  assert.equal(f.requests.length,0);
});

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const flush = () => new Promise((resolve) => setImmediate(resolve));
function memoryStore() {
  let value = null;
  return { read: () => value, write: (next) => { value = next; }, clear: () => { value = null; } };
}
function fixture(t) {
  const requests = [];
  t.mock.method(globalThis, "fetch", (url, init) => {
    const response = deferred();
    requests.push({ url, init, ...response });
    return response.promise;
  });
  const sessionStore = memoryStore();
  const legacySessionStore = memoryStore();
  const client = {
    auth: {
      signInWithPassword: async () => ({ data: { session: { access_token: "test-token" } } }),
      signOut: async () => ({ error: null }),
    },
    rpc: async () => ({ data: { clients: [], projects: [], currentUser: { userId: "test-user" } } }),
    from: () => ({}),
  };
  const api = createSupabaseHybridApi({ url: "https://example.supabase.co", publishableKey: "test" }, {
    supabaseClient: client, sessionStore, legacySessionStore,
    legacyConfig: { endpoint: "https://example.com/legacy", timeoutMs: 1000, credentials: "omit" },
  });
  const finishBridge = (index, token) => requests[index].resolve(new Response(JSON.stringify({
    ok: true, data: { session: { access_token: "unused" }, legacy: { session: { token, expiresIn: 3600 } } },
  })));
  t.after(() => { api.logout(); requests.forEach((request) => request.resolve(new Response("{}"))); });
  return { api, client, requests, sessionStore, legacySessionStore, finishBridge };
}

test("a late bridge response cannot restore a logged-out session", async (t) => {
  const f = fixture(t);
  await f.api.login({ account: "one", accessCode: "test-only" });
  f.api.logout();
  f.finishBridge(0, "old-legacy");
  await flush();
  assert.equal(f.legacySessionStore.read(), null);
  assert.equal(f.requests[0].init.signal.aborted, true);
});

test("account switching clears the previous Sheets identity before warming the new one", async (t) => {
  const f = fixture(t);
  await f.api.login({ account: "one", accessCode: "test-only" });
  f.finishBridge(0, "old-legacy");
  await flush();
  await f.api.login({ account: "two", accessCode: "test-only" });
  assert.equal(f.legacySessionStore.read(), null);
  f.finishBridge(1, "new-legacy");
  await flush();
  assert.equal(f.legacySessionStore.read()?.token, "new-legacy");
});

test("an older bridge finishing cannot detach or overwrite the newer connection", async (t) => {
  const f = fixture(t);
  await f.api.login({ account: "one", accessCode: "test-only" });
  await f.api.login({ account: "two", accessCode: "test-only" });
  f.finishBridge(0, "old-legacy");
  await flush();
  const pendingRead = f.api.files({ projectId: "1" });
  pendingRead.catch(() => {}); // Keep a failing assertion from leaking an unhandled rejection.
  await flush();
  assert.equal(f.requests.length, 2, "legacy read must wait for the current bridge");
  f.finishBridge(1, "new-legacy");
  await flush();
  assert.equal(f.requests.length, 3);
  f.requests[2].resolve(new Response(JSON.stringify({ ok: true, data: { items: [] } })));
  await pendingRead;
  assert.equal(f.legacySessionStore.read()?.token, "new-legacy");
});

test("logout during bootstrap prevents a late login from persisting either session", async (t) => {
  const f = fixture(t);
  const bootstrap = deferred();
  f.client.rpc = () => bootstrap.promise;
  const login = f.api.login({ account: "one", accessCode: "test-only" });
  await flush();
  f.api.logout();
  bootstrap.resolve({ data: { clients: [], projects: [], currentUser: { userId: "old-user" } } });
  await assert.rejects(login, { code: "aborted" });
  assert.equal(f.sessionStore.read(), null);
  assert.equal(f.requests.length, 0);
});

test("unconnected legacy paths return the specific connection error before any request", async (t) => {
  const f = fixture(t);
  await assert.rejects(f.api.files({ projectId: "1" }), { code: "legacy_session_required" });
  await assert.rejects(f.api.mutateBatch({ mutations: [{ entityType: "CONTENT" }] }), { code: "legacy_session_required" });
  assert.equal(f.requests.length, 0);
});

test("server failures and rate limits do not launch a second legacy login", async (t) => {
  const f = fixture(t);
  for (const error of [{ status: 503 }, { status: 429 }, { name: "AuthRetryableFetchError" }]) {
    f.client.auth.signInWithPassword = async () => ({ error });
    await assert.rejects(f.api.login({ account: "one", accessCode: "test-only" }), { code: error.status === 429 ? "rate_limited" : "network_error" });
  }
  assert.equal(f.requests.length, 0);
});

test("a bridge completing last cannot overwrite an already connected newer account", async (t) => {
  const f = fixture(t);
  await f.api.login({ account: "one", accessCode: "test-only" });
  await f.api.login({ account: "two", accessCode: "test-only" });
  f.finishBridge(1, "new-legacy");
  await flush();
  f.finishBridge(0, "old-legacy");
  await flush();
  assert.equal(f.legacySessionStore.read()?.token, "new-legacy");
});

test("invalid credentials still allow the legacy migration fallback", async (t) => {
  const f = fixture(t);
  f.client.auth.signInWithPassword = async () => ({ error: { status: 400, code: "invalid_credentials" } });
  f.client.auth.setSession = async () => ({ error: null });
  const login = f.api.login({ account: "legacy", accessCode: "test-only" });
  await flush();
  assert.equal(f.requests.length, 1);
  f.finishBridge(0, "migrated");
  await login;
  assert.equal(f.legacySessionStore.read()?.token, "migrated");
  assert.equal(f.requests.length, 1, "successful fallback must not run another warmup");
});
