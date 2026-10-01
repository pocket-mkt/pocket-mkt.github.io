import assert from "node:assert/strict";
import test from "node:test";

import { createSupabaseHybridApi } from "../src/supabase/hybridApi.js";
import { createSupabaseAccessAdmin } from "../src/supabase/accessAdmin.js";

function memoryStore(initial = null) {
  let value = initial;
  return {
    read: () => value,
    write: (next) => { value = next; },
    clear: () => { value = null; },
  };
}

test("Supabase 권한 저장은 Sheets 세션이 없어도 성공한다", async () => {
  const calls = [];
  const client = {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "token" } }, error: null }),
      signOut: async () => ({ error: null }),
    },
    functions: {
      invoke: async (name, options) => {
        calls.push({ name, options });
        return { data: { ok: true, data: { saved: true } }, error: null };
      },
    },
    from: () => ({}),
    rpc: async () => ({ data: null, error: null }),
  };
  const api = createSupabaseHybridApi(
    { url: "https://example.supabase.co", publishableKey: "sb_publishable_test" },
    {
      supabaseClient: client,
      sessionStore: memoryStore(),
      legacySessionStore: memoryStore(),
      legacyConfig: {
        endpoint: "https://example.com/apps-script",
        timeoutMs: 30_000,
        credentials: "omit",
      },
    },
  );

  const result = await api.accessAdminMutate({
    operation: "UPSERT",
    account: { account: "client", projectId: "PRJ-1", allowedPages: ["tasks"] },
  });

  assert.equal(result.data.saved, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "access-admin");
});

test('권한관리 HTTP 충돌 응답은 안전한 상세 코드로 표시하고 원시 오류를 노출하지 않는다', async () => {
  const api=createSupabaseAccessAdmin({functions:{invoke:async()=>({data:null,error:{name:'FunctionsHttpError',message:'RAW INTERNAL ERROR',context:new Response(JSON.stringify({error:{code:'conflict',message:'RAW DATABASE DETAIL'}}),{status:409})}})}});
  await assert.rejects(api.mutate({account:{}}),error=>error.code==='conflict' && error.status===409 && !error.message.includes('RAW') && error.message.includes('다른 운영자'));
});
