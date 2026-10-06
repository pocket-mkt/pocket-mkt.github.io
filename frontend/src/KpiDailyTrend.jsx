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
}) {
  const el = useRef(),
    callback = useRef(onSelect);
  callback.current = onSelect;
  useEffect(() => {
    const chart = echarts.init(el.current),
      map = new Map(days.map((d) => [d.date, dayStats(d.body)]));
    chart.setOption({
      animation: false,
      grid: { left: 50, right: 18, top: 20, bottom: 28 },
      tooltip: { trigger: "axis", renderMode: "richText", confine: true },
      xAxis: {
        type: "category",
        data: dates.map((d) => d.slice(8)),
        axisLine: { lineStyle: { color: "#dce4ef" } },
        axisLabel: { color: "#718096" },
      },
      yAxis: {
        type: "value",
        minInterval: 1,
        axisLabel: { color: "#718096" },
        splitLine: { lineStyle: { color: "#eef2f6" } },
      },
      series: [
        {
          type: "bar",
          barMaxWidth: 24,
          data: dates.map((d) => ({
            value: map.get(d)?.[metric] ?? null,
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
      if (p.dataIndex != null) callback.current(dates[p.dataIndex]);
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(el.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [dates, days, metric, selected]);
  return (
    <div
      className="kd-chart"
      ref={el}
      role="img"
      aria-label="일별 성과 추이. 아래 날짜 버튼과 기록표에서 수치를 확인할 수 있습니다."
    />
  );
}
