import { dayStats, monthDays, todayKst } from "./kpiDailyModel.js";
import {
  marketingClickRate,
  sheetTrendDays,
  stageEntries,
} from "./kpiStageModel.js";

export const STAGE_TREND_METRICS = {
  1: ["impressions", "clicks", "ctr", "cost", "posts"],
  2: ["visits"],
  3: ["conversions"],
};
export const trendUnit = (metric) =>
  metric === "ctr"
    ? "%"
    : metric === "cost"
      ? "원"
      : metric === "impressions"
        ? "회"
        : "건";
export const trendLabel = (metric, settings) =>
  ({
    impressions: "노출·조회",
    clicks: "클릭수",
    ctr: "클릭률 (CTR)",
    cost: "집행비",
    posts: "발행",
    visits: settings.inflow_label,
    conversions: settings.conversion_label,
  })[metric];
export const trendNumber = (value) =>
  value == null
    ? "미입력"
    : value > 0 && value < 0.01
      ? "<0.01"
      : value.toLocaleString("ko-KR", { maximumFractionDigits: 2 });

// Only genuine single-day entries become points. Period totals are separately
// listed in full, never copied to their final day or divided into synthetic days.
export function stageTrendData(data, month, stage, metric, today = todayKst()) {
  const dates = monthDays(month).filter((d) => d <= today);
  const daily = new Map(sheetTrendDays(data).map((r) => [r.date, r.body]));
  const ranges = stageEntries(data, stage).filter(
    (r) =>
      r.start !== r.end &&
      r.start.startsWith(month) &&
      r.end.startsWith(month) &&
      r.end <= today,
  );
  const periods = ranges
    .map((r) => {
      const ctr = metric === "ctr" ? marketingClickRate([r]) : null;
      return {
        ...r,
        value:
          metric === "ctr"
            ? ctr.ctr
            : stage === 1
              ? (r[metric] ?? null)
              : r.value,
        ctrInvalid: ctr?.ctrInvalid,
      };
    })
    .filter(
      (r) =>
        r.value != null ||
        (metric === "ctr" && (r.impressions != null || r.clicks != null)),
    );
  const points = dates.map((date) => {
    const body = daily.get(date),
      channels = body?.channels || [],
      stats = dayStats(body);
    const clicks = channels.filter((c) => c.clicks != null);
    const ctr = marketingClickRate(channels);
    const value =
      metric === "ctr"
        ? ctr.ctr
        : metric === "clicks"
          ? clicks.length
            ? clicks.reduce((n, c) => n + c.clicks, 0)
            : null
          : (stats[metric] ?? null);
    return {
      date,
      value,
      period: periods.some((p) => date >= p.start && date <= p.end),
      partial: metric === "ctr" && ctr.ctrExcluded > 0,
      invalid: metric === "ctr" && ctr.ctrInvalid,
    };
  });
  return {
    dates,
    points,
    periods: periods.sort(
      (a, b) => b.end.localeCompare(a.end) || a.source.localeCompare(b.source),
    ),
  };
}
