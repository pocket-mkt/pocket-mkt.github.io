import { test } from "node:test";
import assert from "node:assert/strict";
import {
  overviewTrendData,
  OVERVIEW_METRICS,
} from "../src/kpiOverviewTrendModel.js";
import { defaultSettings, emptyDay } from "../src/kpiDailyModel.js";
const settings = { ...defaultSettings(), inflow_label: "플레이스 방문" };
const record = (entries) => ({ body: { entries } });
const entry = (id, start, end, values) => ({
  id,
  start: `2026-10-${start}`,
  end: `2026-10-${end}`,
  source: "광고",
  ...values,
});
const model = (data, month = "2026-10") =>
  overviewTrendData(data, month, settings, "2026-10-07");
test("overview shares dates and raw count units across three stages without mixing costs or rates", () => {
  const data = {
    days: [],
    stage_sheets: {
      STAGE_1: record([
        entry("a", "01", "01", { impressions: 100, clicks: 10, cost: 5000 }),
      ]),
      STAGE_2: record([entry("v", "01", "01", { value: 8 })]),
      STAGE_3: record([entry("c", "01", "01", { value: 2 })]),
    },
  };
  const before = JSON.stringify(data),
    t = model(data);
  assert.deepEqual(
    t.series.map((s) => s.points[0].value),
    [100, 10, 8, 2],
  );
  assert.ok(
    t.series.every((s) => JSON.stringify(s.dates) === JSON.stringify(t.dates)),
  );
  assert.equal(t.series[2].label, "플레이스 방문");
  assert.deepEqual(
    OVERVIEW_METRICS.filter((s) => s.selected).map((s) => s.stage),
    [1, 2, 3],
  );
  assert.equal(JSON.stringify(data), before);
});
test("overview keeps measured zero, missing gaps and original legacy daily records", () => {
  const t = model({
    days: [
      {
        date: "2026-10-03",
        body: { ...emptyDay(), visits: 0, conversions: 0 },
      },
    ],
    stage_sheets: {},
  });
  assert.deepEqual(
    t.series[2].points.slice(0, 4).map((p) => p.value),
    [null, null, 0, null],
  );
  assert.equal(t.lastMeasured, 2);
});
test("overview counts each stage period once even when multiple metrics are present, never prorates", () => {
  const t = model({
    days: [],
    stage_sheets: {
      STAGE_1: record([
        entry("a", "01", "03", { impressions: 300, clicks: 30 }),
      ]),
      STAGE_2: record([entry("a", "01", "03", { value: 20 })]),
    },
  });
  assert.equal(t.periodCount, 2);
  assert.ok(t.series.every((s) => s.points.every((p) => p.value === null)));
  assert.equal(t.lastMeasured, -1);
});
test("overview respects selected month and excludes future records", () => {
  const t = model({
    days: [
      { date: "2026-10-08", body: { ...emptyDay(), visits: 999 } },
      { date: "2026-09-30", body: { ...emptyDay(), visits: 999 } },
    ],
    stage_sheets: {},
  });
  assert.equal(t.dates.length, 7);
  assert.equal(t.lastMeasured, -1);
  assert.deepEqual(model({ days: [], stage_sheets: {} }, "2026-11").dates, []);
});
