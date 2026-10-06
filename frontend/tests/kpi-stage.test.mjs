import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultSettings, emptyDay, recordDiff } from "../src/kpiDailyModel.js";
import {
  normalizeStageEntry,
  checkStageOverlap,
  effectiveGoals,
  normalizeGoals,
  sheetStats,
  sheetTrendDays,
  goalResult,
} from "../src/kpiStageModel.js";
const entry = (id, start, end, value = 100) => ({
  id,
  start,
  end,
  source: "GA4",
  note: "",
  value,
});
const data = (entries, conversions = []) => ({
  days: [],
  stage_sheets: {
    STAGE_2: { body: { entries } },
    STAGE_3: { body: { entries: conversions } },
  },
});
test("stage dates validate real days, month boundaries, future and zero", () => {
  assert.equal(
    normalizeStageEntry(
      2,
      entry("1", "2026-09-01", "2026-09-01", 0),
      "2026-09",
      "2026-10-06",
    ).value,
    0,
  );
  for (const [start, end] of [
    ["2026-09-31", "2026-09-31"],
    ["2026-08-31", "2026-09-01"],
    ["2026-09-02", "2026-09-01"],
    ["2026-09-01", "2026-10-01"],
  ])
    assert.throws(() =>
      normalizeStageEntry(2, entry("x", start, end), "2026-09", "2026-10-06"),
    );
  assert.throws(() =>
    normalizeStageEntry(
      2,
      entry("x", "2026-10-07", "2026-10-07"),
      "2026-10",
      "2026-10-06",
    ),
  );
  assert.throws(() =>
    normalizeStageEntry(
      2,
      entry("x", "2026-09-01", "2026-09-01", null),
      "2026-09",
    ),
  );
});
test("periods accumulate once, never split into daily bars, ratio requires equal covered dates", () => {
  const d = data(
    [
      entry("a", "2026-09-01", "2026-09-03", 90),
      entry("b", "2026-09-04", "2026-09-04", 10),
    ],
    [entry("c", "2026-09-01", "2026-09-04", 5)],
  );
  const stats = sheetStats(d, "2026-09", "2026-10-06");
  assert.equal(stats.visits, 100);
  assert.equal(stats.rate, 5);
  assert.equal(stats.recorded, 4);
  assert.equal(stats.periodCount, 2);
  assert.deepEqual(
    sheetTrendDays(d).map((r) => [r.date, r.body.visits]),
    [["2026-09-04", 10]],
  );
  d.stage_sheets.STAGE_3.body.entries[0].end = "2026-09-03";
  assert.equal(sheetStats(d, "2026-09", "2026-10-06").rate, null);
});
test("overlap protection across stage sheets and daily entries, distinct channels may overlap", () => {
  const a = entry("a", "2026-09-01", "2026-09-03"),
    b = entry("b", "2026-09-03", "2026-09-04");
  assert.throws(() => checkStageOverlap(2, [a, b], []));
  assert.throws(() =>
    checkStageOverlap(
      2,
      [a],
      [{ date: "2026-09-02", body: { ...emptyDay(), visits: 0 } }],
    ),
  );
  assert.doesNotThrow(() =>
    checkStageOverlap(
      2,
      [a],
      [{ date: "2026-09-02", body: { ...emptyDay(), conversions: 20 } }],
    ),
  );
  assert.doesNotThrow(() =>
    checkStageOverlap(
      1,
      [
        { ...a, source: "Naver" },
        { ...b, source: "Meta" },
      ],
      [],
    ),
  );
  assert.throws(() =>
    checkStageOverlap(
      1,
      [
        { ...a, source: "Naver" },
        { ...b, source: " naver " },
      ],
      [],
    ),
  );
});
test("five flexible goals maximum, legacy compatibility and explicit empty goals", () => {
  const settings = {
    ...defaultSettings(),
    inflow_goal: 100,
    conversion_goal: 10,
  };
  assert.equal(effectiveGoals({}, settings).length, 2);
  assert.deepEqual(
    effectiveGoals({ goals: { body: { goals: [] } } }, settings),
    [],
  );
  const g = {
    id: "g",
    title: "예약",
    metric: "conversions",
    target: 10,
    direction: "AT_LEAST",
  };
  assert.equal(normalizeGoals([g])[0].target, 10);
  assert.throws(() => normalizeGoals(Array.from({ length: 6 }, () => g)));
  assert.throws(() => normalizeGoals([{ ...g, target: null }]));
  assert.equal(goalResult(g, 5).percent, 50);
  assert.equal(goalResult({ ...g, direction: "AT_MOST" }, 0).met, true);
  assert.equal(goalResult(g, null).met, null);
});
test("legacy days and stage records combine without channel attribution doubling", () => {
  const d = data([entry("a", "2026-09-02", "2026-09-02", 20)]);
  d.days = [
    {
      date: "2026-09-01",
      body: {
        ...emptyDay(),
        visits: 10,
        channels: [
          {
            id: "ch",
            name: "검색",
            type: "AD",
            visits: 999,
            conversions: 888,
            cost: 100,
            posts: null,
            impressions: null,
            clicks: 50,
          },
        ],
      },
    },
  ];
  const s = sheetStats(d, "2026-09", "2026-10-06");
  assert.equal(s.visits, 30);
  assert.equal(s.conversions, null);
  assert.equal(s.clicks, 50);
  assert.equal(s.unitCost, null);
  assert.equal(sheetTrendDays(d)[1].body.visits, 20);
});
test("stage and goal history describes edits and removal", () => {
  const a = entry("x", "2026-09-01", "2026-09-03");
  assert.match(
    recordDiff({ entries: [a] }, { entries: [{ ...a, value: 200 }] })[0].after,
    /실적 200/,
  );
  assert.match(recordDiff({ entries: [a] }, { entries: [] })[0].label, /삭제/);
  assert.match(
    recordDiff(null, {
      goals: [
        {
          id: "g",
          title: "예약",
          metric: "conversions",
          target: 5,
          direction: "AT_LEAST",
        },
      ],
    })[0].after,
    /예약/,
  );
});
