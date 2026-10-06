import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { dayStats } from "./kpiDailyModel.js";
echarts.use([
  BarChart,
  LineChart,
  GridComponent,
  TooltipComponent,
  CanvasRenderer,
]);
export default function KpiDailyTrend({
  dates,
  days,
  metric,
  selected,
  onSelect,
  points,
  type = "bar",
  label,
  unit = "",
}) {
  const el = useRef(),
    callback = useRef(onSelect);
  callback.current = onSelect;
  useEffect(() => {
    const chart = echarts.init(el.current),
      map = new Map(days.map((d) => [d.date, dayStats(d.body)])),
      values = points ? new Map(points.map((p) => [p.date, p.value])) : null;
    chart.setOption({
      animation: false,
      grid: { left: 50, right: 18, top: 20, bottom: 28 },
      tooltip: {
        trigger: "axis",
        renderMode: "richText",
        confine: true,
        valueFormatter: (v) =>
          v == null || v === "-"
            ? "미입력"
            : `${Number(v).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}${unit}`,
      },
      xAxis: {
        type: "category",
        data: dates.map((d) => d.slice(5).replace("-", ".")),
        axisLine: { lineStyle: { color: "#dce4ef" } },
        axisLabel: { color: "#718096" },
      },
      yAxis: {
        type: "value",
        min: 0,
        minInterval: metric === "ctr" ? undefined : 1,
        axisLabel: {
          color: "#718096",
          formatter: (v) =>
            v >= 100000000
              ? `${v / 100000000}억`
              : v >= 10000
                ? `${v / 10000}만`
                : v,
        },
        splitLine: { lineStyle: { color: "#eef2f6" } },
      },
      series: [
        {
          name: label,
          type,
          connectNulls: false,
          smooth: false,
          symbol: "circle",
          symbolSize: 7,
          lineStyle: {
            width: 2.5,
            color: metric === "conversions" ? "#139e80" : "#527ed3",
          },
          barMaxWidth: 24,
          data: dates.map((d) => ({
            value: values
              ? (values.get(d) ?? null)
              : (map.get(d)?.[metric] ?? null),
            itemStyle: {
              color:
                d === selected
                  ? "#1e355e"
                  : metric === "conversions"
                    ? "#139e80"
                    : "#86a8ee",
              borderRadius: [3, 3, 0, 0],
            },
          })),
        },
      ],
    });
    chart.on("click", (p) => {
      if (p.dataIndex != null) callback.current?.(dates[p.dataIndex]);
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(el.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [dates, days, metric, selected, points, type, label, unit]);
  return (
    <div
      className="kd-chart"
      ref={el}
      role="img"
      data-kpi-chart-type={type}
      aria-label={`${label || "일별 성과"} 추이. 아래 날짜 버튼과 기록표에서 수치를 확인할 수 있습니다.`}
    />
  );
}
