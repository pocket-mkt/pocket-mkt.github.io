import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultSettings, emptyDay } from "../src/kpiDailyModel.js";
import {
  comparePeriods,
  sheetComparisons,
  comparisonText,
} from "../src/kpiComparisons.js";
import { sheetStats } from "../src/kpiStageModel.js";
const settings = {
  ...defaultSettings(),
  rate_enabled: true,
  inflow_source: "플레이스",
  conversion_source: "예약",
};
const point = (date, value, extra = {}) => ({
  start: `2026-09-${date}`,
  end: `2026-09-${date}`,
  value,
  sources: "a",
  ...extra,
});
const entry = (date, value, source = "플레이스") => ({
  ...point(date, value),
  source,
});
const stageData = (first = [], second = [], third = []) => ({
  days: [],
  stage_sheets: {
    STAGE_1: { body: { entries: first } },
    STAGE_2: { body: { entries: second } },
    STAGE_3: { body: { entries: third } },
  },
});
const compare = (d) => sheetComparisons(d, "2026-09", settings, "2026-10-06");
test("latest two records: 10 then 20 is 100%, while monthly accumulation stays 30", () => {
  const d = stageData([], [entry("10", 20), entry("09", 10)]);
  assert.equal(compare(d).visits.percent, 100);
  assert.equal(sheetStats(d, "2026-09").visits, 30);
  assert.match(
    comparisonText(compare(d).visits, "visits").detail,
    /최근 2026-09-10 · 20건/,
  );
  assert.match(comparisonText(compare(d).visits, "visits").label, /100% 상승/);
});
test("decreases and unchanged values; actual date order is not save order", () => {
  assert.equal(comparePeriods([point("10", 10), point("09", 20)]).percent, -50);
  assert.equal(comparePeriods([point("10", 20), point("09", 20)]).percent, 0);
  assert.equal(
    comparePeriods([point("03", 99), point("09", 20), point("01", 5)]).current
      .value,
    20,
  );
});
test("zero baseline is not infinity or invented 100%; missing/first are explicit", () => {
  assert.equal(
    comparePeriods([point("09", 0), point("10", 20)]).reason,
    "zero",
  );
  assert.equal(comparePeriods([point("09", 0), point("10", 0)]).percent, 0);
  assert.equal(comparePeriods([point("09", 20), point("10", 0)]).percent, -100);
  assert.equal(comparePeriods([]).reason, "empty");
  assert.equal(comparePeriods([point("09", 0)]).reason, "first");
  assert.equal(
    comparePeriods([point("09", 20), point("10", null)]).reason,
    "missing",
  );
});
test("ranges compare once only, equal duration, non-overlap; no daily prorating", () => {
  const a = point("01", 100, { end: "2026-09-03" });
  const b = point("06", 200, { end: "2026-09-08" });
  assert.equal(comparePeriods([b, a]).percent, 100);
  assert.equal(comparePeriods([a, point("06", 100)]).reason, "duration");
  assert.equal(comparePeriods([a, point("03", 100)]).reason, "overlap");
});
test("same-date marketing channels aggregate; changes in measured channels do not fake growth", () => {
  const d = stageData([
    { ...entry("09", 0, " A "), impressions: 10 },
    { ...entry("09", 0, "B"), impressions: 30 },
    { ...entry("10", 0, "a"), impressions: 30 },
    { ...entry("10", 0, "b"), impressions: 50 },
  ]);
  assert.equal(compare(d).impressions.percent, 100);
  assert.equal(compare(d).impressions.current.value, 80);
  d.stage_sheets.STAGE_1.body.entries.pop();
  assert.equal(compare(d).impressions.reason, "sources");
});
test("each metric uses its own previous measured value, not a cost-only row", () => {
  const d = stageData([
    { ...entry("09", 0), impressions: 10, cost: null },
    { ...entry("10", 0), cost: 500, impressions: null },
    { ...entry("11", 0), impressions: 20, cost: null },
  ]);
  assert.equal(compare(d).impressions.percent, 100);
  assert.equal(compare(d).cost.reason, "first");
});
test("DAY and sheet entries compare across formats without attributed double counting", () => {
  const d = stageData([], [entry("10", 20)]);
  d.days = [
    {
      date: "2026-09-09",
      body: {
        ...emptyDay(),
        visits: 10,
        channels: [{ name: "광고", visits: 999 }],
      },
    },
  ];
  assert.equal(compare(d).visits.percent, 100);
  assert.equal(compare(d).visits.previous.value, 10);
});
test("CTR compares weighted paired records, never averages percentages or cross-pairs", () => {
  const d = stageData([
    { ...entry("09", 0, "a"), impressions: 100, clicks: 10 },
    { ...entry("09", 0, "b"), impressions: 900, clicks: 0 },
    { ...entry("10", 0, "a"), impressions: 100, clicks: 20 },
    { ...entry("10", 0, "b"), impressions: 900, clicks: 0 },
  ]);
  assert.equal(compare(d).ctr.previous.value, 1);
  assert.equal(compare(d).ctr.current.value, 2);
  assert.equal(compare(d).ctr.percent, 100);
  d.stage_sheets.STAGE_1.body.entries[3].clicks = null;
  assert.equal(compare(d).ctr.reason, "sources");
  d.stage_sheets.STAGE_1.body.entries[2].impressions = 0;
  assert.equal(compare(d).ctr.reason, "missing");
});
test("conversion rate and unit cost compare matching period values, not cumulative totals", () => {
  const d = stageData(
    [
      { ...entry("09", 0), cost: 100 },
      { ...entry("10", 0), cost: 300 },
    ],
    [entry("09", 10), entry("10", 20)],
    [entry("09", 1, "예약"), entry("10", 4, "예약")],
  );
  assert.equal(compare(d).rate.percent, 100);
  assert.equal(compare(d).unitCost.percent, -25);
  d.stage_sheets.STAGE_3.body.entries.pop();
  assert.equal(compare(d).rate.reason, "missing");
  assert.equal(compare(d).unitCost.reason, "missing");
  assert.equal(
    sheetComparisons(d, "2026-09", { ...settings, rate_enabled: false }).rate
      .reason,
    "empty",
  );
});
test("source changes are explicit, unrelated month/future records excluded", () => {
  const d = stageData([], [entry("09", 10), entry("10", 20, "홈페이지")]);
  assert.equal(compare(d).visits.reason, "sources");
  d.stage_sheets.STAGE_2.body.entries.push({
    start: "2026-10-01",
    end: "2026-10-01",
    value: 10000,
  });
  assert.equal(compare(d).visits.current.value, 20);
  assert.equal(
    sheetComparisons(d, "2026-09", settings, "2026-09-09").visits.reason,
    "first",
  );
});
test("format distinguishes tiny changes from zero and exposes ratio's relative change", () => {
  const c = comparePeriods([point("09", 10000), point("10", 10001)]);
  assert.match(comparisonText(c, "cost").label, /0.1% 미만 상승/);
  assert.match(comparisonText(c, "ctr").detail, /퍼센트포인트 차이가 아닙니다/);
  assert.equal(comparisonText(comparePeriods([]), "posts").label, "기록 없음");
});
