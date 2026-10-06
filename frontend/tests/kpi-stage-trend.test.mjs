import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyDay, defaultSettings } from "../src/kpiDailyModel.js";
import {
  stageTrendData,
  STAGE_TREND_METRICS,
  trendLabel,
} from "../src/kpiStageTrendModel.js";
const entry = (id, start, end, extra = {}) => ({
  id,
  start: `2026-10-${start}`,
  end: `2026-10-${end}`,
  source: "검색광고",
  ...extra,
});
const body = (entries) => ({ body: { entries } });
const sample = () => ({ days: [], stage_sheets: {} });
const trend = (d, stage, metric) =>
  stageTrendData(d, "2026-10", stage, metric, "2026-10-07");
test("trend preserves missing gaps, measured zero and month/future boundaries", () => {
  const d = sample();
  d.days = [
    { date: "2026-10-01", body: { ...emptyDay(), visits: 10 } },
    { date: "2026-10-03", body: { ...emptyDay(), visits: 0 } },
    { date: "2026-10-08", body: { ...emptyDay(), visits: 999 } },
    { date: "2026-09-30", body: { ...emptyDay(), visits: 999 } },
  ];
  const t = trend(d, 2, "visits");
  assert.equal(t.points.length, 7);
  assert.deepEqual(
    t.points.slice(0, 3).map((p) => p.value),
    [10, null, 0],
  );
  assert.equal(t.points.at(-1).value, null);
});
test("daily entries and single-day sheet records share a timeline, attribution is not doubled", () => {
  const d = sample();
  d.days = [
    {
      date: "2026-10-01",
      body: {
        ...emptyDay(),
        visits: 10,
        channels: [{ name: "광고", visits: 500 }],
      },
    },
  ];
  d.stage_sheets.STAGE_2 = body([entry("v", "02", "02", { value: 20 })]);
  assert.deepEqual(
    trend(d, 2, "visits")
      .points.slice(0, 2)
      .map((p) => p.value),
    [10, 20],
  );
});
test("period totals remain separate, not divided or placed on range end", () => {
  const d = sample();
  d.stage_sheets.STAGE_2 = body([entry("v", "01", "03", { value: 300 })]);
  const t = trend(d, 2, "visits");
  assert.ok(t.points.every((p) => p.value === null));
  assert.deepEqual(
    t.points.slice(0, 4).map((p) => p.period),
    [true, true, true, false],
  );
  assert.equal(t.periods[0].value, 300);
  assert.equal(t.periods[0].start, "2026-10-01");
});
test("marketing single-day metrics aggregate channels without requiring cost", () => {
  const d = sample();
  d.stage_sheets.STAGE_1 = body([
    entry("a", "01", "01", { impressions: 10, clicks: 2, posts: 0 }),
    entry("b", "01", "01", {
      source: "블로그",
      impressions: 20,
      clicks: 1,
      posts: 2,
    }),
    entry("c", "02", "04", { impressions: 900, clicks: 90, posts: 3 }),
  ]);
  assert.equal(trend(d, 1, "impressions").points[0].value, 30);
  assert.equal(trend(d, 1, "clicks").points[0].value, 3);
  assert.equal(trend(d, 1, "cost").points[0].value, null);
  assert.equal(trend(d, 1, "posts").points[0].value, 2);
  assert.equal(trend(d, 1, "impressions").points[2].value, null);
});
test("daily CTR pairs exact channel/day values and flags partial and invalid inputs", () => {
  const d = sample();
  d.stage_sheets.STAGE_1 = body([
    entry("a", "01", "01", { impressions: 100, clicks: 10 }),
    entry("b", "01", "01", { impressions: 900, clicks: 0 }),
    entry("c", "01", "01", { impressions: 10000, clicks: null }),
    entry("d", "02", "02", { impressions: 0, clicks: 2 }),
    entry("e", "03", "03", { impressions: 100, clicks: 0 }),
  ]);
  const t = trend(d, 1, "ctr");
  assert.equal(t.points[0].value, 1);
  assert.equal(t.points[0].partial, true);
  assert.equal(t.points[1].value, null);
  assert.equal(t.points[1].invalid, true);
  assert.equal(t.points[2].value, 0);
});
test("daily partial coverage plus range totals are explicitly separated", () => {
  const d = sample();
  d.stage_sheets.STAGE_1 = body([
    entry("a", "01", "03", { impressions: 100 }),
    entry("b", "02", "02", { source: "블로그", impressions: 20 }),
  ]);
  const t = trend(d, 1, "impressions");
  assert.equal(t.points[1].value, 20);
  assert.equal(t.points[1].period, true);
  assert.equal(t.periods[0].value, 100);
});
test("empty/future month and dynamic inflow label do not invent numbers", () => {
  assert.deepEqual(
    stageTrendData(sample(), "2026-11", 2, "visits", "2026-10-07").points,
    [],
  );
  assert.equal(
    trendLabel("visits", {
      ...defaultSettings(),
      inflow_label: "플레이스 방문",
    }),
    "플레이스 방문",
  );
  assert.deepEqual(STAGE_TREND_METRICS[1], [
    "impressions",
    "clicks",
    "ctr",
    "cost",
    "posts",
  ]);
  assert.deepEqual(STAGE_TREND_METRICS[3], ["conversions"]);
});
