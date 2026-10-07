import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import {
  overviewTrendData,
  OVERVIEW_METRICS,
} from "./kpiOverviewTrendModel.js";
import { trendNumber } from "./kpiStageTrendModel.js";
import "./kpiOverviewTrend.css";

echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);

export default function KpiOverviewTrend({ data, month, settings }) {
  const [visible, setVisible] = useState(() =>
    OVERVIEW_METRICS.filter((m) => m.selected).map((m) => m.key),
  );
  const [selected, setSelected] = useState(null);
  const canvas = useRef(null),
    chart = useRef(null);
  const model = useMemo(
    () => overviewTrendData(data, month, settings),
    [data, month, settings],
  );
  const active = useMemo(
    () => model.series.filter((s) => visible.includes(s.key)),
    [model, visible],
  );
  const selectedIndex = model.dates.includes(selected)
    ? model.dates.indexOf(selected)
    : Math.max(0, model.lastMeasured);
  const date = model.dates[selectedIndex];
  const hasValues = active.some((s) => s.points.some((p) => p.value != null));
  const datesRef = useRef(model.dates);
  datesRef.current = model.dates;

  useEffect(() => {
    const instance = echarts.init(canvas.current);
    chart.current = instance;
    instance.on("click", (event) => {
      if (event.dataIndex != null)
        setSelected(datesRef.current[event.dataIndex]);
    });
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(canvas.current);
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(
      {
        animation: false,
        textStyle: { fontFamily: "Pretendard, sans-serif" },
        grid: { left: 12, right: 18, top: 32, bottom: 12, containLabel: true },
        tooltip: { trigger: "axis", renderMode: "richText", confine: true },
        xAxis: {
          type: "category",
          boundaryGap: false,
          data: model.dates.map((d) => d.slice(5).replace("-", ".")),
          axisLine: { lineStyle: { color: "#dce4ef" } },
          axisTick: { show: false },
          axisLabel: { color: "#718096", hideOverlap: true },
        },
        yAxis: {
          type: "value",
          name: "회 · 건",
          min: 0,
          minInterval: 1,
          nameTextStyle: { color: "#718096" },
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
        series: active.map((s) => ({
          id: s.key,
          name: `${s.stage}단계 · ${s.label}`,
          type: "line",
          connectNulls: false,
          smooth: false,
          symbol: "circle",
          symbolSize: 7,
          lineStyle: { width: 2.5, color: s.color },
          itemStyle: { color: s.color },
          emphasis: { focus: "series" },
          tooltip: {
            valueFormatter: (v) =>
              v == null || v === "-"
                ? "미입력"
                : `${trendNumber(Number(v))}${s.unit}`,
          },
          data: s.points.map((p) => p.value),
        })),
      },
      { notMerge: true },
    );
  }, [model, active]);

  return (
    <section className="ko-trend" aria-labelledby="ko-title">
      <header className="ko-heading">
        <div>
          <h3 id="ko-title">전체 성과 추이</h3>
          <p>광고·콘텐츠 → 유입 → 전환의 일별 실적</p>
        </div>
        <span>{month.replace("-", ".")} · 일별</span>
      </header>
      <div className="ko-legend" role="group" aria-label="통합 차트 표시 지표">
        {model.series.map((s) => (
          <button
            key={s.key}
            type="button"
            data-metric={s.key}
            aria-pressed={visible.includes(s.key)}
            onClick={() =>
              setVisible((keys) =>
                keys.includes(s.key)
                  ? keys.filter((k) => k !== s.key)
                  : [...keys, s.key],
              )
            }
          >
            <i style={{ background: s.color }} aria-hidden="true" />
            {s.label}
          </button>
        ))}
        <small>눌러서 표시 / 숨김</small>
      </div>
      <div className="ko-plot">
        <div
          className="ko-chart"
          ref={canvas}
          role="img"
          aria-label="전체 성과 일별 선 그래프. 아래 날짜 선택 막대에서 각 날짜의 수치를 확인할 수 있습니다."
        />
        {!hasValues && (
          <p className="ko-empty" role="status">
            {!active.length
              ? "범례에서 표시할 지표를 선택하세요."
              : model.periodCount
                ? "기간 합계는 카드에 반영됩니다. 일별 기록이 생기면 그래프에 표시됩니다."
                : "아직 표시할 일별 실적이 없습니다."}
          </p>
        )}
      </div>
      {!!model.dates.length && (
        <div className="ko-detail">
          <div className="ko-date">
            <b>{date?.replaceAll("-", ".")}</b>
            <input
              type="range"
              min="0"
              max={model.dates.length - 1}
              value={selectedIndex}
              disabled={model.dates.length < 2}
              aria-label="통합 추이 확인 날짜"
              aria-valuetext={date}
              onChange={(e) => setSelected(model.dates[Number(e.target.value)])}
            />
          </div>
          <div className="ko-values" aria-live="polite">
            {active.map((s) => (
              <span key={s.key}>
                <i style={{ background: s.color }} aria-hidden="true" />
                {s.label}{" "}
                <b>
                  {s.points[selectedIndex]?.value == null
                    ? "미입력"
                    : `${trendNumber(s.points[selectedIndex].value)}${s.unit}`}
                </b>
              </span>
            ))}
          </div>
        </div>
      )}
      <p className="ko-note">
        빈 날짜는 미입력입니다. 기간 합계는 일별로 나누지 않습니다.
        {model.periodCount > 0 &&
          ` 기간 합계 ${model.periodCount}건은 카드 누적에만 포함됩니다.`}
      </p>
    </section>
  );
}
