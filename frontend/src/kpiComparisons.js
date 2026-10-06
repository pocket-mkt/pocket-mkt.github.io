import { todayKst } from "./kpiDailyModel.js";
import {
  GOAL_METRICS,
  marketingClickRate,
  stageEntries,
  stageFields,
} from "./kpiStageModel.js";

const sum = (values) => values.reduce((n, v) => n + v, 0);
const sourceKey = (value) => (value || "").trim().toLocaleLowerCase();
const periodKey = (row) => `${row.start}/${row.end}`;
const length = (row) =>
  (Date.parse(row.end) - Date.parse(row.start)) / 86400000 + 1;
const sourceSet = (rows) =>
  [...new Set(rows.map((r) => sourceKey(r.source)))].sort().join(" / ");

// Date order, not edit order. Compare the latest two measured periods, never
// cumulative month totals against a single day or two different channels.
export function comparePeriods(points) {
  const [current, previous] = [...points].sort(
    (a, b) => b.end.localeCompare(a.end) || b.start.localeCompare(a.start),
  );
  const result = { current, previous, percent: null, reason: null };
  if (!current) result.reason = "empty";
  else if (!previous) result.reason = "first";
  else if (previous.end >= current.start) result.reason = "overlap";
  else if (length(current) !== length(previous)) result.reason = "duration";
  else if (current.value == null || previous.value == null)
    result.reason = "missing";
  else if (current.sources !== previous.sources) result.reason = "sources";
  else if (previous.value === 0 && current.value !== 0) result.reason = "zero";
  else
    result.percent =
      previous.value === 0
        ? 0
        : ((current.value - previous.value) / previous.value) * 100;
  return result;
}

// The visible project/month is the comparison boundary. Do not fetch other
// months/projects or silently mix the legacy monthly funnel into daily records.
export function sheetComparisons(data, month, settings, today = todayKst()) {
  const valid = (r) =>
    r.start?.startsWith(month) && r.end?.startsWith(month) && r.end <= today;
  const marketing = [],
    overall = { visits: [], conversions: [] };
  for (const day of data?.days || []) {
    const period = { start: day.date, end: day.date };
    if (!valid(period)) continue;
    for (const channel of day.body.channels || [])
      if (stageFields(1).some((k) => channel[k] != null))
        marketing.push({ ...channel, ...period, source: channel.name });
    for (const [metric, source] of [
      ["visits", settings.inflow_source],
      ["conversions", settings.conversion_source],
    ])
      if (day.body[metric] != null)
        overall[metric].push({
          ...period,
          value: day.body[metric],
          sources: sourceKey(source),
        });
  }
  marketing.push(...stageEntries(data, 1).filter(valid));
  for (const [stage, metric] of [
    [2, "visits"],
    [3, "conversions"],
  ])
    overall[metric].push(
      ...stageEntries(data, stage)
        .filter(valid)
        .map((e) => ({
          start: e.start,
          end: e.end,
          value: e.value,
          sources: sourceKey(e.source),
        })),
    );
  const groups = new Map();
  for (const row of marketing) {
    const key = periodKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const observations = {
    ...overall,
    ctr: [],
    cost: [],
    impressions: [],
    clicks: [],
    posts: [],
  };
  for (const rows of groups.values()) {
    const period = { start: rows[0].start, end: rows[0].end };
    for (const metric of stageFields(1)) {
      const measured = rows.filter((r) => r[metric] != null);
      if (measured.length)
        observations[metric].push({
          ...period,
          value: sum(measured.map((r) => r[metric])),
          sources: sourceSet(measured),
        });
    }
    const paired = rows.filter(
      (r) => r.impressions != null && r.clicks != null,
    );
    if (rows.some((r) => r.impressions != null || r.clicks != null)) {
      const rate = marketingClickRate(rows);
      observations.ctr.push({
        ...period,
        value: rate.ctr,
        sources: sourceSet(paired),
        excluded: rate.ctrExcluded,
      });
    }
  }
  // Derived ratios require matching exact recorded periods; do not spread range
  // totals over dates or use the last available denominator from a different day.
  function ratios(numerator, denominator, scale) {
    const top = new Map(observations[numerator].map((r) => [periodKey(r), r]));
    const bottom = new Map(
      observations[denominator].map((r) => [periodKey(r), r]),
    );
    return [...new Set([...top.keys(), ...bottom.keys()])].map((key) => {
      const n = top.get(key),
        d = bottom.get(key),
        period = n || d;
      return {
        start: period.start,
        end: period.end,
        value:
          n?.value != null && d?.value > 0 ? (n.value / d.value) * scale : null,
        sources: `${n?.sources ?? "?"} → ${d?.sources ?? "?"}`,
      };
    });
  }
  observations.rate = settings.rate_enabled
    ? ratios("conversions", "visits", 100)
    : [];
  observations.unitCost = ratios("cost", "conversions", 1);
  return Object.fromEntries(
    Object.entries(observations).map(([key, rows]) => [
      key,
      comparePeriods(rows),
    ]),
  );
}

const reasons = {
  empty: "기록 없음",
  first: "이전 기록 없음",
  overlap: "기간 겹침",
  duration: "기간 길이 다름",
  missing: "비교값 미입력",
  sources: "측정 출처 다름",
  zero: "이전 값 0",
};
const format = (v) =>
  v == null
    ? "미입력"
    : v.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
const period = (p) => (p.start === p.end ? p.start : `${p.start} ~ ${p.end}`);
export function comparisonText(comparison, metric) {
  const c = comparison || { reason: "empty" },
    value = c.percent;
  const direction = value > 0 ? "up" : value < 0 ? "down" : "flat";
  const magnitude =
    value != null && Math.abs(value) > 0 && Math.abs(value) < 0.1
      ? "0.1% 미만"
      : `${Math.abs(value || 0).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%`;
  const label = c.reason
    ? reasons[c.reason]
    : value === 0
      ? "0% 변동 없음"
      : `${magnitude} ${value > 0 ? "상승" : "하락"}`;
  const unit = ["ctr", "rate"].includes(metric)
    ? "%"
    : ["cost", "unitCost"].includes(metric)
      ? "원"
      : metric === "impressions"
        ? "회"
        : "건";
  const name =
    GOAL_METRICS[metric] ||
    { ctr: "클릭률", rate: "전환율", unitCost: "전환당 비용" }[metric];
  const line = (p) =>
    `${period(p)} · ${format(p.value)}${p.value == null ? "" : unit}${p.excluded ? ` (미입력 ${p.excluded}개 제외)` : ""}`;
  const detail = [
    `${name}: ${label}. 선택 월 내 최근 기록 비교 (월 누적 증감 아님).`,
    c.current && `최근 ${line(c.current)}`,
    c.previous && `직전 ${line(c.previous)}`,
    c.reason === "zero" && "이전 값이 0이므로 증감률을 계산하지 않습니다.",
    c.reason === "sources" &&
      `최근 출처: ${c.current.sources || "미지정"} / 직전 출처: ${c.previous.sources || "미지정"}`,
    ["ctr", "rate"].includes(metric) &&
      !c.reason &&
      "비율의 상대 증감률입니다. 퍼센트포인트 차이가 아닙니다.",
  ]
    .filter(Boolean)
    .join("\n");
  return { label, detail, direction: c.reason ? "unknown" : direction };
}
