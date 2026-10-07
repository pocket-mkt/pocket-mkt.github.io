import { stageTrendData, trendLabel, trendUnit } from "./kpiStageTrendModel.js";

export const OVERVIEW_METRICS = [
  { key: "impressions", stage: 1, color: "#039fbe", selected: true },
  { key: "clicks", stage: 1, color: "#8b5cb6", selected: false },
  { key: "visits", stage: 2, color: "#4169e1", selected: true },
  { key: "conversions", stage: 3, color: "#099c7c", selected: true },
];

// Reuse the card charts' canonical daily projection, never split period totals.
export function overviewTrendData(data, month, settings, today) {
  const series = OVERVIEW_METRICS.map((metric) => ({
    ...metric,
    label: trendLabel(metric.key, settings),
    unit: trendUnit(metric.key),
    ...stageTrendData(data, month, metric.stage, metric.key, today),
  }));
  const dates = series[0].dates;
  const periodKeys = new Set(
    series.flatMap((s) => s.periods.map((p) => `${s.stage}:${p.id}`)),
  );
  const lastMeasured = dates.findLastIndex((_, i) =>
    series.some((s) => s.points[i]?.value != null),
  );
  return { dates, series, periodCount: periodKeys.size, lastMeasured };
}
