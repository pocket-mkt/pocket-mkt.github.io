import { useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { useDialogSurface } from "./useDialogSurface.js";
import { STAGES } from "./kpiStageModel.js";
import {
  STAGE_TREND_METRICS,
  stageTrendData,
  trendLabel,
  trendNumber,
  trendUnit,
} from "./kpiStageTrendModel.js";
import KpiDailyTrend from "./KpiDailyTrend.jsx";
import "./kpiStageTrend.css";

export default function KpiStageTrend({
  stage,
  month,
  data,
  settings,
  canWrite,
  onClose,
  onEntry,
}) {
  const [metric, setMetric] = useState(STAGE_TREND_METRICS[stage][0]);
  const [windowDays, setWindowDays] = useState(0);
  const [selected, setSelected] = useState(null);
  const surface = useRef(null);
  useDialogSurface(true, surface, onClose);
  const model = useMemo(
    () => stageTrendData(data, month, stage, metric),
    [data, month, stage, metric],
  );
  const points = useMemo(
    () => (windowDays ? model.points.slice(-windowDays) : model.points),
    [model, windowDays],
  );
  const dates = useMemo(() => points.map((p) => p.date), [points]);
  const periods = model.periods.filter(
    (r) => dates.length && r.end >= dates[0] && r.start <= dates.at(-1),
  );
  const measured = points.filter((p) => p.value != null);
  const current =
    points.find((p) => p.date === selected) || measured.at(-1) || points.at(-1);
  const name = trendLabel(metric, settings),
    unit = trendUnit(metric);
  const valueText = (p) =>
    p?.value == null
      ? p?.invalid
        ? "노출·클릭 확인 필요"
        : p?.period
          ? "기간 합계로만 기록"
          : "미입력"
      : `${trendNumber(p.value)}${unit}`;
  return (
    <div
      className="ks-backdrop kt-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="ks-dialog kt-dialog"
        ref={surface}
        role="dialog"
        aria-modal="true"
        aria-labelledby="kt-title"
        aria-describedby="kt-description"
        tabIndex={-1}
      >
        <header className="ks-heading">
          <div>
            <span>
              {month.replace("-", "년 ")}월 · {stage}단계
            </span>
            <h2 id="kt-title">{STAGES[stage - 1]} 일별 추이</h2>
          </div>
          <div className="kt-actions">
            <button type="button" className="kt-entry" onClick={onEntry}>
              <Plus size={14} />
              {canWrite ? "데이터 입력" : "기록 보기"}
            </button>
            <button
              type="button"
              data-dialog-close
              aria-label="추이 닫기"
              onClick={onClose}
            >
              <X size={19} />
            </button>
          </div>
        </header>
        <div className="ks-body kt-body">
          <p id="kt-description">
            일별 실적의 변화를 확인합니다. 빈 날짜는 미입력이며, 기간 합계는
            그래프에 나누어 넣지 않습니다.
          </p>
          <div className="kt-controls">
            <div className="kt-metrics" aria-label="추이 지표">
              {STAGE_TREND_METRICS[stage].map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={metric === key}
                  onClick={() => setMetric(key)}
                >
                  {trendLabel(key, settings)}
                </button>
              ))}
            </div>
            <div className="kt-window" aria-label="추이 조회 기간">
              {[
                [0, "월 전체"],
                [7, "최근 7일"],
                [14, "최근 14일"],
              ].map(([n, label]) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={windowDays === n}
                  onClick={() => setWindowDays(n)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="kt-summary" aria-live="polite">
            <div>
              <span>
                {current?.date?.replaceAll("-", ".") || month} · {name}
              </span>
              <strong>{valueText(current)}</strong>
            </div>
            <p>
              {dates.length
                ? `${dates[0].slice(5)} ~ ${dates.at(-1).slice(5)}`
                : "조회 가능한 날짜 없음"}
              <br />
              일별 입력 {measured.length}일 / {dates.length}일
            </p>
          </div>
          <KpiDailyTrend
            dates={dates}
            days={[]}
            points={points}
            metric={metric}
            selected={current?.date}
            onSelect={setSelected}
            type="line"
            label={name}
            unit={unit}
          />
          {!measured.length && (
            <p className="kt-empty" role="status">
              {periods.length
                ? "기간 합계 기록만 있습니다. 일별 데이터를 입력하면 추이 그래프가 표시됩니다."
                : "아직 일별 실적이 없습니다. 데이터 입력에서 날짜별 실적을 추가해 주세요."}
            </p>
          )}
          <p className="kt-chart-help">
            그래프의 점을 누르면 해당 날짜의 수치를 확인할 수 있습니다. 선이
            끊긴 구간은 미입력입니다.
            {metric === "ctr" &&
              " 클릭률은 같은 날짜·채널에 함께 입력된 클릭수 ÷ 노출·조회로 계산합니다."}
          </p>
          {current?.partial && (
            <p className="kt-warning">
              선택일 클릭률은 노출·조회와 클릭수가 모두 입력된 일부 기록
              기준입니다.
            </p>
          )}
          {current?.period && current.value != null && (
            <p className="kt-warning">
              선택일에는 별도의 기간 합계도 있습니다. 그래프에는 일별로 입력한
              실적만 표시됩니다.
            </p>
          )}
          <details className="kt-values">
            <summary>날짜별 수치 확인</summary>
            <div className="kt-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>날짜</th>
                    <th>{name}</th>
                    <th>집계 상태</th>
                  </tr>
                </thead>
                <tbody>
                  {points.map((p) => (
                    <tr key={p.date}>
                      <td>
                        <button
                          type="button"
                          aria-pressed={current?.date === p.date}
                          onClick={() => setSelected(p.date)}
                        >
                          {p.date.slice(5)}
                        </button>
                      </td>
                      <td>{valueText(p)}</td>
                      <td>
                        {p.invalid
                          ? "입력 확인 필요"
                          : p.period
                            ? "기간 합계 별도"
                            : p.partial
                              ? "일부 기록"
                              : p.value == null
                                ? "미입력"
                                : "일별 실적"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          {periods.length > 0 && (
            <section className="kt-periods">
              <h3>기간 합계 · 일별 그래프와 별도</h3>
              <p>
                원래 입력한 기간의 전체 합계입니다. 조회 구간과 일부만 겹쳐도
                일할 계산하지 않습니다.
              </p>
              <div className="kt-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>기록 기간</th>
                      <th>채널·측정 출처</th>
                      <th>{name}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {periods.map((p) => (
                      <tr key={p.id}>
                        <td>
                          {p.start.slice(5)} ~ {p.end.slice(5)}
                        </td>
                        <td>{p.source}</td>
                        <td>
                          {p.value == null
                            ? "계산 불가"
                            : `${trendNumber(p.value)}${unit}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}
