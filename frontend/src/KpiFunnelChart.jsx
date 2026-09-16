import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { SankeyChart } from "echarts/charts";
import { TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
echarts.use([SankeyChart, TooltipComponent, CanvasRenderer]);
export default function KpiFunnelChart({
  channels,
  totals,
  name,
  inflow,
  selected,
  onSelect,
}) {
  const ref = useRef(),
    callback = useRef(onSelect);
  callback.current = onSelect;
  useEffect(() => {
    const chart = echarts.init(ref.current);
    const labels = Object.fromEntries(
      channels.map((c) => [
        "c:" + c.id,
        c.name + "\n" + c.visits.toLocaleString() + " 유입",
      ]),
    );
    Object.assign(labels, {
      traffic: inflow + "\n" + totals.visits.toLocaleString(),
      done: name + "\n" + totals.conversions.toLocaleString() + "건",
      rest: "미전환\n" + (totals.visits - totals.conversions).toLocaleString(),
    });
    chart.setOption({
      animation: false,
      tooltip: {
        renderMode: "richText",
        confine: true,
        formatter: (p) =>
          p.dataType === "edge"
            ? p.value.toLocaleString() + " 세션"
            : labels[p.name],
      },
      series: [
        {
          type: "sankey",
          left: 8,
          right: 150,
          top: 22,
          bottom: 25,
          nodeWidth: 12,
          nodeGap: 26,
          layoutIterations: 0,
          draggable: false,
          data: [
            ...channels.map((c) => ({
              name: "c:" + c.id,
              depth: 0,
              itemStyle: {
                color: selected && selected !== c.id ? "#c9d6ed" : "#4c7dff",
              },
            })),
            { name: "traffic", depth: 1, itemStyle: { color: "#4c7dff" } },
            { name: "done", depth: 2, itemStyle: { color: "#346cf3" } },
            { name: "rest", depth: 2, itemStyle: { color: "#ccd5e1" } },
          ],
          links: [
            ...channels.map((c) => ({
              source: "c:" + c.id,
              target: "traffic",
              value: c.visits,
              lineStyle: {
                color: selected && selected !== c.id ? "#e7edf7" : "#9cb9ff",
                opacity: 0.35,
              },
            })),
            {
              source: "traffic",
              target: "done",
              value: totals.conversions,
              lineStyle: { color: "#6998ff", opacity: 0.55 },
            },
            {
              source: "traffic",
              target: "rest",
              value: totals.visits - totals.conversions,
              lineStyle: { color: "#dbe2ed", opacity: 0.45 },
            },
          ],
          label: {
            fontFamily: "Pretendard,sans-serif",
            fontSize: 13,
            lineHeight: 22,
            color: "#203654",
            formatter: (p) => labels[p.name],
          },
          lineStyle: { curveness: 0.5 },
          emphasis: { focus: "adjacency" },
        },
      ],
    });
    chart.on("click", (p) => {
      const key = p.dataType === "edge" ? p.data.source : p.name;
      if (key.startsWith("c:")) callback.current(key.slice(2));
    });
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [channels, totals, name, inflow, selected]);
  return (
    <div
      ref={ref}
      className="kf-chart"
      style={{ height: Math.max(290, channels.length * 57) }}
      role="img"
      aria-label="광고·콘텐츠에서 전체 유입 하나로 모인 뒤 전환·미전환으로 나뉩니다. 수치는 채널별 성과 표에서도 확인할 수 있습니다."
    />
  );
}
