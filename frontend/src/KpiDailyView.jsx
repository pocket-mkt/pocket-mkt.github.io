import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Plus,
  Settings2,
} from "lucide-react";
import { defaultSettings, recordDiff, todayKst } from "./kpiDailyModel.js";
import { moveMonth } from "./kpiFunnelModel.js";
import { useKpiDailyDraft } from "./useKpiDailyDraft.js";
import KpiStageSheets, { StageGoals } from "./KpiStageSheets.jsx";
import KpiDelta from "./KpiDelta.jsx";
import { sheetComparisons } from "./kpiComparisons.js";
import { effectiveGoals, sheetStats } from "./kpiStageModel.js";
import "./kpiDaily.css";
const StageTrend = lazy(() => import("./KpiStageTrend.jsx"));
const fmt = (v) =>
  v == null
    ? "—"
    : Number(v).toLocaleString("ko-KR", { maximumFractionDigits: 1 });
const fmtCtr = (v) =>
  v == null
    ? "—"
    : v > 0 && v < 0.01
      ? "<0.01"
      : v.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
const stamp = (v) =>
  v
    ? new Date(v).toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
const statusText = {
  saved: "저장 완료",
  dirty: "입력 중 · 다른 칸으로 이동하면 저장",
  saving: "저장 중…",
  error: "저장되지 않음",
};

function SaveStatus({ editor, onReload }) {
  return (
    <div className={"kd-save " + editor.status} aria-live="polite">
      <span>{statusText[editor.status]}</span>
      {editor.error && (
        <>
          <span role="alert">{editor.error.message}</span>
          <button
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob(
                  [
                    JSON.stringify(
                      {
                        date: editor.date,
                        kind: editor.kind,
                        draft: editor.draft,
                      },
                      null,
                      2,
                    ),
                  ],
                  { type: "application/json;charset=utf-8;" },
                ),
              );
              const link = document.createElement("a");
              link.href = url;
              link.download = `KPI-입력백업-${editor.date}.json`;
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            입력 전체 백업
          </button>
          {editor.error.code !== "conflict" &&
            editor.error.code !== "forbidden" && (
              <button onClick={() => editor.flush()}>저장 재시도</button>
            )}
          {onReload &&
            ["conflict", "forbidden"].includes(editor.error.code) && (
              <button onClick={onReload}>충돌·권한 다시 확인</button>
            )}
        </>
      )}
    </div>
  );
}
function History({ source, projectId, kind, date, version }) {
  const [open, setOpen] = useState(false),
    [revision, setRevision] = useState(0),
    [state, setState] = useState({
      items: [],
      loading: false,
      error: null,
      next: null,
    });
  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    setState({ items: [], loading: true, error: null, next: null });
    source
      .kpiDailyHistory({ projectId, kind, date, signal: ctrl.signal })
      .then((r) => {
        if (!ctrl.signal.aborted)
          setState({
            items: r.data.items,
            loading: false,
            error: null,
            next: r.data.next_cursor,
          });
      })
      .catch((error) => {
        if (!ctrl.signal.aborted)
          setState({ items: [], loading: false, error, next: null });
      });
    return () => ctrl.abort();
  }, [open, source, projectId, kind, date, version, revision]);
  async function more() {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const r = await source.kpiDailyHistory({
        projectId,
        kind,
        date,
        beforeId: state.next,
      });
      setState((s) => ({
        ...s,
        items: [...s.items, ...r.data.items],
        loading: false,
        next: r.data.next_cursor,
      }));
    } catch (error) {
      setState((s) => ({ ...s, loading: false, error }));
    }
  }
  return (
    <details
      className="kd-history"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>수정 이력 · 작성자와 변경 내용</summary>
      {open && (
        <div>
          {state.loading && <p role="status">이력을 확인하는 중…</p>}
          {state.error && (
            <p role="alert">
              {state.error.message}{" "}
              <button
                onClick={() => {
                  setRevision((v) => v + 1);
                }}
              >
                다시 시도
              </button>
            </p>
          )}
          {state.items.map((h) => (
            <article key={h.id}>
              <header>
                <b>{h.actor}</b>
                <span>
                  {stamp(h.occurred_at)} · {h.before_body ? "수정" : "생성"} · v
                  {h.row_version}
                </span>
              </header>
              <ul>
                {recordDiff(h.before_body, h.after_body).map((d, i) => (
                  <li key={i}>
                    <b>{d.label}</b>{" "}
                    {d.before == null ? "미입력" : String(d.before)} →{" "}
                    {d.after == null ? "미입력" : String(d.after)}
                  </li>
                ))}
              </ul>
            </article>
          ))}
          {state.next && (
            <button disabled={state.loading} onClick={more}>
              이전 이력 더 보기
            </button>
          )}
          {!state.loading && !state.items.length && !state.error && (
            <p>저장 이력이 없습니다.</p>
          )}
        </div>
      )}
    </details>
  );
}

function CardSettings({ initial, children, ...props }) {
  const editor = useKpiDailyDraft({ initial, kind: "SETTINGS", ...props });
  return children(editor, !props.canWrite || editor.locked);
}

export default function KpiDailyView({ project, source, canWrite }) {
  const today = todayKst(),
    [month, setMonth] = useState(() => today.slice(0, 7)),
    [state, setState] = useState({ loading: true, data: null, error: null }),
    [revision, setRevision] = useState(0),
    [editorEpoch, setEditorEpoch] = useState(0),
    [sheet, setSheet] = useState(null),
    [trendStage, setTrendStage] = useState(null),
    [notice, setNotice] = useState("");
  const guards = useRef(new Map()),
    loadGeneration = useRef(0);
  const latestState = useRef(state);
  const openSheetRef = useRef(sheet);
  openSheetRef.current = sheet != null || trendStage != null;
  const closeSheet = useCallback(() => setSheet(null), []);
  const closeTrend = useCallback(() => setTrendStage(null), []);
  latestState.current = state;
  const register = useCallback((key, guard) => {
    guards.current.set(key, guard);
    return () => {
      if (guards.current.get(key) === guard) guards.current.delete(key);
    };
  }, []);
  useEffect(() => {
    const handler = (event) => {
      if ([...guards.current.values()].some((g) => g.dirty() || g.pending())) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const navigate = (event) => {
      const list = [...guards.current.values()];
      if (list.some((g) => g.pending())) {
        event.preventDefault();
        setNotice("저장 중입니다. 완료 후 이동해 주세요.");
      } else if (
        list.some((g) => g.dirty()) &&
        !confirm("저장되지 않은 KPI 입력이 있습니다. 버리고 이동할까요?")
      )
        event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    window.addEventListener("pocket:before-navigate", navigate);
    return () => {
      window.removeEventListener("beforeunload", handler);
      window.removeEventListener("pocket:before-navigate", navigate);
    };
  }, []);
  const guard = async () => {
    for (const g of guards.current.values()) {
      if (!(await g.flush()))
        return confirm(
          "저장되지 않은 입력이 있습니다. 현재 입력을 버리고 이동할까요?",
        );
    }
    return true;
  };
  useEffect(() => {
    const ctrl = new AbortController(),
      generation = ++loadGeneration.current;
    setState({ loading: true, data: null, error: null });
    source
      .kpiDaily({ projectId: project.id, month, signal: ctrl.signal })
      .then((r) => {
        if (!ctrl.signal.aborted && generation === loadGeneration.current)
          setState({ loading: false, data: r.data, error: null });
      })
      .catch((error) => {
        if (!ctrl.signal.aborted && generation === loadGeneration.current)
          setState({ loading: false, data: null, error });
      });
    return () => ctrl.abort();
  }, [source, project.id, month, revision]);
  useEffect(() => {
    let disposed = false,
      controller = null,
      lastAttempt = 0;
    const safe = () =>
      document.visibilityState === "visible" &&
      !openSheetRef.current &&
      !latestState.current.loading &&
      latestState.current.data &&
      !document.activeElement?.closest("[data-kpi-editor]") &&
      ![...guards.current.values()].some((g) => g.dirty() || g.pending());
    const refresh = async () => {
      if (controller || !safe() || Date.now() - lastAttempt < 15000) return;
      lastAttempt = Date.now();
      const ctrl = new AbortController();
      controller = ctrl;
      try {
        const result = await source.kpiDaily({
          projectId: project.id,
          month,
          signal: ctrl.signal,
        });
        if (
          !disposed &&
          safe() &&
          JSON.stringify(result.data) !==
            JSON.stringify(latestState.current.data)
        ) {
          setState({ loading: false, data: result.data, error: null });
          setEditorEpoch((n) => n + 1);
        }
      } catch (error) {
        if (!disposed) {
          if (error.code === "forbidden")
            setState({ loading: false, data: null, error });
          else
            setNotice(
              "최신 기록 동기화에 실패했습니다. 표시 중인 값은 마지막으로 확인한 기록입니다.",
            );
        }
      } finally {
        controller = null;
      }
    };
    const timer = setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => {
      disposed = true;
      controller?.abort();
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [source, project.id, month, revision]);
  const days = state.data?.days || [],
    settings =
      state.data?.settings?.body ||
      state.data?.inherited_settings ||
      defaultSettings(),
    writer = canWrite && state.data?.canWrite;
  const totals = sheetStats(state.data, month, today),
    comparisons = sheetComparisons(state.data, month, settings, today),
    goals = effectiveGoals(state.data, settings);
  const selectMonth = async (value) => {
    if (
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(value) ||
      value < "2000-01" ||
      value > "2100-12"
    )
      return;
    if (await guard()) {
      setMonth(value);
      setNotice("");
    }
  };
  const savedSettings = (item) =>
    setState((s) => ({ ...s, data: { ...s.data, settings: item } }));
  const savedSheet = (kind, item) =>
    setState((s) => ({
      ...s,
      data: {
        ...s.data,
        ...(kind === "GOALS"
          ? { goals: item }
          : { stage_sheets: { ...s.data.stage_sheets, [kind]: item } }),
      },
    }));
  const openPanel = async (stage, mode) => {
    for (const g of guards.current.values())
      if (!(await g.flush())) {
        setNotice("현재 입력의 저장을 먼저 완료해 주세요.");
        return;
      }
    setSheet(mode === "sheet" ? stage : null);
    setTrendStage(mode === "trend" ? stage : null);
  };
  const openSheet = (stage) => openPanel(stage, "sheet");
  const openTrend = (stage) => openPanel(stage, "trend");
  const reloadRecords = async () => {
    if ([...guards.current.values()].some((g) => g.pending())) {
      setNotice("저장 중입니다. 완료 후 다시 확인해 주세요.");
      return;
    }
    if (await guard()) {
      setSheet(null);
      setTrendStage(null);
      setRevision((r) => r + 1);
    }
  };
  const stageAction = (stage) => ({
    onClick: (e) => {
      if (!e.target.closest("button, input, label, details, [data-kpi-editor]"))
        openTrend(stage);
    },
  });
  return (
    <div className="kd-workspace">
      <header className="kd-heading">
        <div>
          <span className="kd-eyebrow">
            {project.clientName || project.name}
          </span>
          <h2>KPI 성과</h2>
          <p>3단계 성과를 기록하고, 목표 대비 추이를 확인합니다.</p>
        </div>
        <div className="kd-toolbar">
          <button
            aria-label="KPI 이전 달"
            disabled={month === "2000-01"}
            onClick={() => selectMonth(moveMonth(month, -1))}
          >
            <ChevronLeft size={16} />
          </button>
          <input
            aria-label="KPI 집계 월"
            type="month"
            min="2000-01"
            max="2100-12"
            value={month}
            onChange={(e) => selectMonth(e.target.value)}
          />
          <button
            aria-label="KPI 다음 달"
            disabled={month === "2100-12"}
            onClick={() => selectMonth(moveMonth(month, 1))}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </header>
      {notice && (
        <p className="kd-notice" role="status">
          {notice}
        </p>
      )}
      {state.loading ? (
        <div className="kd-empty" role="status">
          일별 KPI 기록을 확인하는 중…
        </div>
      ) : state.error ? (
        <div className="kd-error" role="alert">
          {state.error.message}
          <button onClick={() => setRevision((r) => r + 1)}>다시 시도</button>
        </div>
      ) : (
        <>
          <div className="kd-summary-heading">
            <span>
              <b>{month.replace("-", "년 ")}월 누적</b> · 날짜·기간별 저장 실적
            </span>
            <span className={totals.partial ? "kd-partial" : ""}>
              실적 포함 {totals.recorded}일 · 기간 합계 {totals.periodCount}건
            </span>
            <div className="kd-summary-actions">
              <button onClick={() => openSheet("GOALS")}>
                <Settings2 size={14} /> 목표 설정 {goals.length}/5
              </button>
              <button
                className="kd-primary"
                aria-label={writer ? "KPI 데이터 입력" : "KPI 입력 기록"}
                onClick={() => openSheet(1)}
              >
                <Plus size={14} /> {writer ? "데이터 입력" : "입력 기록"}
              </button>
            </div>
          </div>
          <CardSettings
            key={"settings:" + month + ":" + revision + ":" + editorEpoch}
            initial={
              state.data.settings || { body: settings, row_version: null }
            }
            source={source}
            projectId={project.id}
            date={month + "-01"}
            canWrite={writer}
            register={register}
            onSaved={savedSettings}
            onReload={reloadRecords}
          >
            {(settingsEditor, settingsDisabled) => (
              <>
                <p className="kd-comparison-note">
                  주요 수치는 월 집계 · 작은 증감률은 선택 월의 최근 기록 ↔
                  직전 기록 기준입니다. 증감률을 누르면 비교 날짜와 값을 볼 수
                  있습니다.
                </p>
                <div className="kd-funnel">
                  <article className="kd-stage marketing" {...stageAction(1)}>
                    <header>
                      <span>1</span>
                      <h3>
                        <button
                          className="kd-stage-title"
                          aria-label="1단계 광고·콘텐츠 일별 추이 보기"
                          onClick={() => openTrend(1)}
                        >
                          광고·콘텐츠
                        </button>
                      </h3>
                    </header>
                    <dl
                      className="kd-marketing-metrics"
                      aria-label="광고·콘텐츠 누적 성과"
                    >
                      <div data-metric="impressions">
                        <dt>누적 노출·조회</dt>
                        <dd>
                          {fmt(totals.impressions)}
                          <small>회</small>
                          <KpiDelta
                            metric="impressions"
                            comparison={comparisons.impressions}
                          />
                        </dd>
                      </div>
                      <div data-metric="clicks">
                        <dt>누적 클릭수</dt>
                        <dd>
                          {fmt(totals.clicks)}
                          <small>건</small>
                          <KpiDelta
                            metric="clicks"
                            comparison={comparisons.clicks}
                          />
                        </dd>
                      </div>
                      <div data-metric="ctr">
                        <dt>
                          클릭률 (CTR)
                          {totals.ctrExcluded > 0 && <span>일부 기록</span>}
                        </dt>
                        <dd>
                          {fmtCtr(totals.ctr)}
                          <small>%</small>
                          <KpiDelta metric="ctr" comparison={comparisons.ctr} />
                        </dd>
                      </div>
                      <div data-metric="cost">
                        <dt>누적 집행비</dt>
                        <dd>
                          {fmt(totals.cost)}
                          <small>원</small>
                          <KpiDelta
                            metric="cost"
                            comparison={comparisons.cost}
                          />
                        </dd>
                      </div>
                    </dl>
                    <StageGoals
                      goals={goals}
                      totals={totals}
                      comparisons={comparisons}
                      stage={1}
                    />
                    <footer>
                      <div>
                        발행 <b>{fmt(totals.posts)}건</b>
                        <KpiDelta
                          metric="posts"
                          comparison={comparisons.posts}
                        />
                      </div>
                      <span className="kd-ctr-basis">
                        {totals.ctrInvalid
                          ? "클릭률 확인 필요: 노출·조회 0인 기록에 클릭수가 있습니다."
                          : totals.ctr != null
                            ? `CTR: 클릭 ${fmt(totals.ctrClicks)} ÷ 노출·조회 ${fmt(totals.ctrImpressions)}${totals.ctrExcluded ? ` · 미입력 ${totals.ctrExcluded}개 기록 제외` : ""}`
                            : totals.ctrImpressions === 0
                              ? "노출·조회가 0이면 클릭률을 계산하지 않습니다."
                              : "클릭률은 같은 기록에 노출·조회와 클릭수를 입력하면 계산됩니다."}
                      </span>
                    </footer>
                  </article>
                  <ArrowRight className="kd-arrow" size={20} />
                  <article className="kd-stage traffic" {...stageAction(2)}>
                    <header>
                      <span>2</span>
                      <h3>
                        <button
                          className="kd-stage-title"
                          aria-label="2단계 유입 일별 추이 보기"
                          onClick={() => openTrend(2)}
                        >
                          유입
                        </button>
                      </h3>
                    </header>
                    <div className="kd-inflow-name" data-kpi-editor="SETTINGS">
                      <label>
                        <span>유입 항목{writer ? " · 직접 수정" : ""}</span>
                        <input
                          aria-label="2단계 유입 항목 이름"
                          value={settingsEditor.draft.inflow_label}
                          maxLength={200}
                          placeholder="예: 플레이스 방문, 전화 문의, 홈페이지 유입"
                          disabled={settingsDisabled}
                          onChange={(event) =>
                            settingsEditor.change((body) => ({
                              ...body,
                              inflow_label: event.target.value,
                            }))
                          }
                          onBlur={settingsEditor.flush}
                          onKeyDown={(event) => {
                            if (
                              event.key === "Enter" &&
                              !event.nativeEvent.isComposing
                            ) {
                              event.preventDefault();
                              event.currentTarget.blur();
                            }
                          }}
                        />
                      </label>
                      {writer && settingsEditor.status !== "saved" && (
                        <SaveStatus
                          editor={settingsEditor}
                          onReload={reloadRecords}
                        />
                      )}
                    </div>
                    <div className="kd-main-value">
                      <strong>
                        {fmt(totals.visits)}
                        <small>건</small>
                      </strong>
                      <KpiDelta
                        metric="visits"
                        comparison={comparisons.visits}
                      />
                    </div>
                    <StageGoals
                      goals={goals}
                      totals={totals}
                      comparisons={comparisons}
                      stage={2}
                    />
                    {settings.inflow_source && (
                      <footer>{settings.inflow_source}</footer>
                    )}
                  </article>
                  <ArrowRight className="kd-arrow" size={20} />
                  <article className="kd-stage conversion" {...stageAction(3)}>
                    <header>
                      <span>3</span>
                      <h3>
                        <button
                          className="kd-stage-title"
                          aria-label="3단계 전환 일별 추이 보기"
                          onClick={() => openTrend(3)}
                        >
                          전환
                        </button>
                      </h3>
                    </header>
                    <p className="kd-metric-caption">
                      {settings.conversion_label}
                    </p>
                    <div className="kd-main-value">
                      <strong>
                        {fmt(totals.conversions)}
                        <small>건</small>
                      </strong>
                      <KpiDelta
                        metric="conversions"
                        comparison={comparisons.conversions}
                      />
                    </div>
                    <StageGoals
                      goals={goals}
                      totals={totals}
                      comparisons={comparisons}
                      stage={3}
                    />
                    <footer>
                      <div>
                        유입 대비{" "}
                        <b>
                          {settings.rate_enabled && totals.rate != null
                            ? fmt(totals.rate) + "%"
                            : "기준 확인 필요"}
                        </b>
                        {settings.rate_enabled && totals.rate != null && (
                          <KpiDelta
                            metric="rate"
                            comparison={comparisons.rate}
                          />
                        )}
                      </div>
                      <div>
                        집행비 / 전체 전환 <b>{fmt(totals.unitCost)}원</b>
                        {totals.unitCost != null && (
                          <KpiDelta
                            metric="unitCost"
                            comparison={comparisons.unitCost}
                          />
                        )}
                      </div>
                    </footer>
                  </article>
                </div>
                <p className="kd-help">
                  카드 본문을 누르면 일별 추이가 열립니다. 실적 추가·수정은 카드
                  위 공통 ‘데이터 입력’에서 단계를 선택해 진행합니다. 기간
                  합계는 한 번만 누적하며, 채널별 유입·전환은 전체 수치에 더하지
                  않습니다. 미확인 값은 0으로 처리하지 않습니다.
                </p>
              </>
            )}
          </CardSettings>
          {trendStage != null && (
            <Suspense
              fallback={<p role="status">일별 추이 차트를 준비하는 중…</p>}
            >
              <StageTrend
                key={project.id + ":" + month + ":" + trendStage}
                stage={trendStage}
                month={month}
                data={state.data}
                settings={settings}
                onClose={closeTrend}
              />
            </Suspense>
          )}
          {sheet != null && (
            <KpiStageSheets
              key={project.id + ":" + month + ":" + sheet}
              stage={sheet}
              month={month}
              initial={
                sheet === "GOALS"
                  ? state.data.goals
                  : state.data.stage_sheets?.[`STAGE_${sheet}`]
              }
              goals={goals}
              settings={settings}
              days={days}
              source={source}
              projectId={project.id}
              canWrite={writer}
              onSaved={savedSheet}
              onClose={closeSheet}
              onStageChange={setSheet}
              onReload={reloadRecords}
              register={register}
              History={History}
            />
          )}
        </>
      )}
    </div>
  );
}
