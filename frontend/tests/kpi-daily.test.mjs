import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultSettings,
  emptyDay,
  newChannel,
  channelDay,
  monthlyStats,
  dayStats,
  defaultDay,
  monthDays,
  numberValue,
  dailyCsv,
  importDailyCsv,
  pasteMetrics,
  recordDiff,
} from "../src/kpiDailyModel.js";
import { createKpiDailyApi } from "../src/supabase/kpiDailyApi.js";
import {createHubDataSource} from '../src/api/dataSource.js';
const day = () => ({
  ...emptyDay(),
  visits: 100,
  conversions: 5,
  channels: [
    {
      ...channelDay(newChannel("네이버", "AD", "naver")),
      cost: 10000,
      visits: 999,
      conversions: 999,
      posts: 1,
      impressions: 3000,
    },
  ],
});
test('real data-source registry exposes native daily read/history/save and rejects old-session results',async()=>{
 const calls=[];let release;
 const live={kpiDaily:async p=>{calls.push(['read',p]);return {data:{days:[]}};},kpiDailyHistory:async p=>{calls.push(['history',p]);return {data:{items:[]}};},saveKpiDaily:p=>{calls.push(['save',p]);return new Promise(r=>release=r);},logout:()=>{}};
 const source=createHubDataSource({config:{endpoint:'https://example.invalid/api',hasEndpoint:true},supabaseLive:live,env:{VITE_POCKET_DATA_BACKEND:'supabase',VITE_SUPABASE_URL:'https://example.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'public-test-key'}});
 const ctrl=new AbortController();await source.kpiDaily({projectId:1,month:'2026-10',signal:ctrl.signal});await source.kpiDailyHistory({projectId:1,date:'2026-10-01'});
 const pending=source.saveKpiDaily({projectId:1,kind:'DAY',body:day()});const rejected=assert.rejects(pending,{code:'aborted'});source.logout();release({data:{item:{}}});await rejected;
 assert.deepEqual(calls.map(c=>c[0]),['read','history','save']);assert.equal(calls[0][1].signal,ctrl.signal);
});
test("daily totals never double count attributed channel outcomes; zero and unknown differ", () => {
  const d = day(),
    m = monthlyStats(
      [{ date: "2026-10-01", body: d }],
      "2026-10",
      "2026-10-02",
    );
  assert.equal(m.visits, 100);
  assert.equal(m.conversions, 5);
  assert.equal(m.rate, 5);
  assert.equal(m.unitCost, 2000);
  assert.equal(m.partial, false);
  assert.equal(dayStats(emptyDay()).visits, null);
  assert.equal(dayStats({ ...emptyDay(), visits: 0 }).visits, 0);
  assert.equal(monthlyStats([], "2026-10", "2026-10-03").missing, 2);
  const partial = monthlyStats(
    [
      { date: "2026-10-01", body: d },
      { date: "2026-10-02", body: { ...d, visits: null } },
    ],
    "2026-10",
    "2026-10-03",
  );
  assert.equal(partial.rate, null);
  assert.equal(partial.partial, true);
  assert.equal(partial.visits, 100);
  assert.equal(
    monthlyStats([{ date: "2026-09-01", body: d }], "2026-10", "2026-10-03")
      .recorded,
    0,
  );
});
test("date defaults are Korea-day based and bounded to selected month", () => {
  assert.equal(defaultDay("2026-10", "2026-10-06"), "2026-10-05");
  assert.equal(defaultDay("2026-10", "2026-10-01"), "2026-10-01");
  assert.equal(defaultDay("2026-09", "2026-10-06"), "2026-09-30");
  assert.equal(monthDays("2024-02").length, 29);
});
test("standard CSV roundtrip preserves null, zero, quotes, channel identity and briefing", () => {
  const d = day();
  d.channels[0].name = '네이버, "검색"';
  d.channels[0].cost = 0;
  d.execution = "보존할 브리핑";
  assert.deepEqual(importDailyCsv(dailyCsv(d), d), d);
  d.channels[0].name = "=danger()";
  assert.match(dailyCsv(d), /'=danger/);
  assert.deepEqual(importDailyCsv(dailyCsv(d), d), d);
  assert.throws(() => importDailyCsv("arbitrary,export", d));
  assert.throws(() =>
    importDailyCsv(
      dailyCsv({ ...d, channels: [...d.channels, ...d.channels] }),
      d,
    ),
  );
});
test("multi-cell paste is atomic, rejects bounds/negative/formula and never changes narrative", () => {
  const d = day();
  const next = pasteMetrics(d, 0, 0, "20\t100\t5\t1\t2\t0");
  assert.equal(next.channels[0].cost, 20);
  assert.equal(next.channels[0].conversions, 0);
  assert.equal(d.channels[0].cost, 10000);
  for (const text of ["-1\t5", "=1+1\t5", "2\t3\t4\t5\t6\t7\t8"])
    assert.throws(() => pasteMetrics(d, 0, 0, text));
  assert.equal(numberValue("1,500"), 1500);
  assert.equal(numberValue(""), null);
  assert.throws(() => numberValue("0", true));
  assert.ok(
    recordDiff(d, { ...d, conversions: 6 }).some(
      (c) => c.label === "전체 전환" && c.before === 5 && c.after === 6,
    ),
  );
});
test("API forwards strict mutation and cancellation envelopes", async () => {
  const calls = [];
  const client = {
    rpc: (name, args) => {
      calls.push({ name, args });
      return {
        abortSignal: (signal) => {
          calls.at(-1).signal = signal;
          return Promise.resolve({ data: { days: [] } });
        },
        then: (resolve) =>
          Promise.resolve({ data: { item: {} } }).then(resolve),
      };
    },
  };
  const api = createKpiDailyApi(client),
    ctrl = new AbortController();
  await api.read({ projectId: 1, month: "2026-10", signal: ctrl.signal });
  assert.equal(calls[0].args.p_month, "2026-10-01");
  assert.equal(calls[0].signal, ctrl.signal);
  await api.save({
    projectId: 1,
    kind: "DAY",
    date: "2026-10-01",
    body: day(),
    rowVersion: 3,
    mutationId: "uuid",
  });
  assert.equal(calls[1].args.p_expected_version, 3);
  assert.equal(calls[1].args.p_mutation_id, "uuid");
});
