import assert from "node:assert/strict";
import test from "node:test";

import { createSupabaseCredentialLedger, credentialMutationArguments } from "../src/supabase/credentialLedger.js";

function rpcClient(handler) {
  return { rpc: async (name, args) => handler(name, args) };
}

test("계정 목록은 프로젝트 RPC를 사용하고 비밀번호 식별자가 섞이면 거부한다", async () => {
  const calls = [];
  const ledger = createSupabaseCredentialLedger(rpcClient((name, args) => {
    calls.push({ name, args });
    return { data: { items: [{ credential_id: 7, site_name: "광고 관리자" }], totalMatching: 1 }, error: null };
  }));

  const response = await ledger.read({ projectId: 31 });
  assert.equal(response.data.items[0].credential_id, 7);
  assert.deepEqual(calls, [{ name: "read_project_credentials", args: { p_project_id: "31" } }]);

  const unsafe = createSupabaseCredentialLedger(rpcClient(() => ({
    data: { items: [{ credential_id: 7, password_secret_id: "vault-id" }] },
    error: null,
  })));
  await assert.rejects(() => unsafe.read({ projectId: 31 }), (error) => error.code === "invalid_contract");
});

test("비밀번호는 지정한 한 건의 별도 reveal RPC로만 요청한다", async () => {
  const calls = [];
  const ledger = createSupabaseCredentialLedger(rpcClient((name, args) => {
    calls.push({ name, args });
    return { data: { credentialId: 7, password: "temporary-value", revealedAt: "2026-09-07T00:00:00Z" }, error: null };
  }));

  const response = await ledger.reveal({ projectId: 31, credentialId: 7 });
  assert.equal(response.data.password, "temporary-value");
  assert.deepEqual(calls, [{ name: "reveal_project_credential", args: { p_project_id: "31", p_credential_id: "7" } }]);
});

test("생성·수정·보관 mutation은 Vault RPC 계약과 낙관적 버전을 지킨다", () => {
  const created = credentialMutationArguments({
    projectId: 31,
    mutationId: "cred-create-1",
    mutation: { operation: "CREATE", fields: { site_name: "Meta", password: "secret" } },
  });
  assert.deepEqual(created, {
    p_mutation_id: "cred-create-1",
    p_operation: "CREATE",
    p_project_id: "31",
    p_credential_id: null,
    p_expected_row_version: null,
    p_fields: { site_name: "Meta", password: "secret" },
  });

  const updated = credentialMutationArguments({
    projectId: 31,
    mutation: { operation: "UPDATE", id: 7, expectedRowVersion: 3, fields: { notes: "2FA" } },
  });
  assert.equal(updated.p_operation, "UPDATE");
  assert.equal(updated.p_credential_id, "7");
  assert.equal(updated.p_expected_row_version, "3");
  assert.match(updated.p_mutation_id, /^credential_/);

  assert.throws(() => credentialMutationArguments({ projectId: 31, mutation: { operation: "UPDATE", id: 7, expectedRowVersion: 0 } }), (error) => error.code === "invalid_supabase_id");
});
