import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyFunnel,
  monthNow,
  moveMonth,
  metricValue,
  validateFunnel,
  funnelTotals,
} from "../src/kpiFunnelModel.js";
import { createKpiFunnelApi } from "../src/supabase/kpiFunnelApi.js";
import { createHubDataSource } from "../src/api/dataSource.js";
test("application data source allows funnel reads and writes", async () => {
  const calls = [];
  const live = {
    kpiFunnel: async (p) => {
      calls.push(p);
      return { ok: true, data: { item: null } };
    },
    saveKpiFunnel: async (p) => {
      calls.push(p);
      return { ok: true, data: { item: null } };
    },
  };
  const source = createHubDataSource({
    config: {
      hasEndpoint: true,
      endpoint: "https://example.invalid",
      mode: "live",
    },
    live,
  });
  await source.kpiFunnel({ projectId: 1, month: "2026-09" });
  await source.saveKpiFunnel({ projectId: 1, body: emptyFunnel() });
  assert.equal(calls.length, 2);
});
test("funnel unknown is not zero; goals and channel totals", () => {
  assert.match(monthNow(), /^\d{4}-\d{2}$/);
  assert.equal(moveMonth("2026-01", -1), "2025-12");
  assert.equal(metricValue(""), null);
  assert.equal(metricValue("0"), 0);
  assert.throws(() => metricValue(0, { goal: true }));
  assert.throws(() => metricValue(1.5));
  assert.equal(funnelTotals([]).visits, null);
  const channels = [
    { id: "a", name: "a", type: "AD", visits: 100, conversions: 5, cost: 1000 },
    {
      id: "b",
      name: "b",
      type: "CONTENT",
      visits: 50,
      conversions: 10,
      cost: 0,
    },
  ];
  assert.deepEqual(funnelTotals(channels), {
    visits: 150,
    conversions: 15,
    cost: 1000,
    rate: 10,
    paidCost: 200,
  });
  assert.equal(
    funnelTotals([...channels, { visits: null, conversions: null, cost: null }])
      .visits,
    null,
  );
  assert.throws(() =>
    validateFunnel({
      ...emptyFunnel(),
      channels: [{ ...channels[0], conversions: 101 }],
    }),
  );
});
test("funnel RPC preserves version and mutation, maps conflicts", async () => {
  const calls = [];
  const api = createKpiFunnelApi({
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: { item: null } };
    },
  });
  await api.read({ projectId: 1, month: "2026-09" });
  await api.save({
    projectId: 1,
    month: "2026-09",
    body: emptyFunnel(),
    rowVersion: 4,
    mutationId: "uuid",
  });
  assert.equal(calls[0].args.p_month, "2026-09-01");
  assert.equal(calls[1].args.p_expected_version, 4);
  assert.equal(calls[1].args.p_mutation_id, "uuid");
  const fail = createKpiFunnelApi({
    rpc: async () => ({ error: { code: "40001" } }),
  });
  await assert.rejects(
    fail.read({ projectId: 1, month: "2026-09" }),
    (e) => e.code === "conflict",
  );
});
