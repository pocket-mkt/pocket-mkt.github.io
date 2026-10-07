import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FileUp,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";
import {
  BRIEF_LABELS,
  METRICS,
  METRIC_LABELS,
  channelDay,
  dailyCsv,
  dayStats,
  defaultDay,
  defaultSettings,
  emptyDay,
  importDailyCsv,
  monthDays,
  newChannel,
  pasteMetrics,
  recordDiff,
  todayKst,
} from "./kpiDailyModel.js";
import { moveMonth } from "./kpiFunnelModel.js";
import { useKpiDailyDraft } from "./useKpiDailyDraft.js";
import KpiStageSheets, { StageGoals } from "./KpiStageSheets.jsx";
import KpiDelta from "./KpiDelta.jsx";
import { sheetComparisons } from "./kpiComparisons.js";
import {
  effectiveGoals,
  sheetStats,
  sheetTrendDays,
  stageEntries,
} from "./kpiStageModel.js";
import "./kpiDaily.css";
const Trend = lazy(() => import("./KpiDailyTrend.jsx"));
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
const TYPES = { AD: "광고", CONTENT: "콘텐츠", OTHER: "기타" };
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
function EditField({
  label,
  value,
  onChange,
  onBlur,
  disabled,
  numeric = false,
  ...props
}) {
  return (
    <label className="kd-field">
      <span>{label}</span>
      <input
        {...props}
        aria-label={label}
        inputMode={numeric ? "numeric" : undefined}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        disabled={disabled}
      />
    </label>
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

function SettingsEditor({ initial, children, ...props }) {
  const e = useKpiDailyDraft({ initial, kind: "SETTINGS", ...props }),
    disabled = !props.canWrite || e.locked;
  const change = (k, v) => e.change((b) => ({ ...b, [k]: v }));
  return (
    <>
      {children?.(e, disabled)}
      <details className="kd-settings">
        <summary>
          <Settings2 size={15} /> 측정 기준·운영 채널
        </summary>
        <div data-kpi-editor="SETTINGS">
          <p>
            이 설정은 이번 달에만 적용됩니다. 기존 일별 실적의 숫자와 채널
            기록은 바뀌지 않습니다.
          </p>
          <div className="kd-settings-grid">
            {[
              ["inflow_label", "유입 이름"],
              ["conversion_label", "전환 이름"],
              ["inflow_source", "유입 데이터 출처"],
              ["conversion_source", "전환 데이터 출처"],
            ].map(([k, label]) => (
              <EditField
                key={k}
                label={label}
                numeric={k.endsWith("goal")}
                value={e.draft[k]}
                onChange={(v) => change(k, v)}
                onBlur={e.flush}
                disabled={disabled}
              />
            ))}
          </div>
          <EditField
            label="집계 기준"
            placeholder="예: GA4 세션과 중복·취소를 제외한 실제 예약 건수, 한국시간 기준"
            value={e.draft.definition}
            onChange={(v) => change("definition", v)}
            onBlur={e.flush}
            disabled={disabled}
          />
          <label className="kd-check">
            <input
              type="checkbox"
              checked={e.draft.rate_enabled}
              disabled={disabled}
              onChange={(event) => {
                change("rate_enabled", event.target.checked);
                queueMicrotask(e.flush);
              }}
            />{" "}
            동일한 기간·범위의 유입과 전환으로 비율 표시 (사람별 경로 추적은
            아님)
          </label>
          <div className="kd-roster">
            {e.draft.channels.map((c, i) => (
              <div key={c.id}>
                <input
                  aria-label={`운영 채널 ${i + 1} 이름`}
                  value={c.name}
                  maxLength={80}
                  disabled={disabled}
                  onChange={(v) =>
                    e.change((b) => ({
                      ...b,
                      channels: b.channels.map((x) =>
                        x.id === c.id ? { ...x, name: v.target.value } : x,
                      ),
                    }))
                  }
                  onBlur={e.flush}
                />
                <select
                  aria-label={`운영 채널 ${i + 1} 유형`}
                  value={c.type}
                  disabled={disabled}
                  onChange={(v) => {
                    e.change((b) => ({
                      ...b,
                      channels: b.channels.map((x) =>
                        x.id === c.id ? { ...x, type: v.target.value } : x,
                      ),
                    }));
                    queueMicrotask(e.flush);
                  }}
                >
                  {Object.entries(TYPES).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                {props.canWrite && (
                  <button
                    disabled={disabled}
                    aria-label={`${c.name} 운영 목록에서 제거`}
                    onClick={() => {
                      if (
                        !confirm(
                          "다음 신규 기록의 기본 채널 목록에서만 제거합니다. 과거 실적은 유지됩니다.",
                        )
                      )
                        return;
                      e.change((b) => ({
                        ...b,
                        channels: b.channels.filter((x) => x.id !== c.id),
                      }));
                      queueMicrotask(e.flush);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {props.canWrite && (
            <button
              disabled={disabled || e.draft.channels.length >= 40}
              onClick={() => {
                e.change((b) => ({
                  ...b,
                  channels: [...b.channels, newChannel()],
                }));
              }}
            >
              <Plus size={14} /> 운영 채널 추가
            </button>
          )}
          <SaveStatus editor={e} onReload={props.onReload} />
        </div>
        <History
          source={props.source}
          projectId={props.projectId}
          kind="SETTINGS"
          date={props.date}
          version={initial.row_version}
        />
      </details>
    </>
  );
}

function DayEditor({
  initial,
  settings,
  onJumpTasks,
  onCopyRoster,
  stageRows = [],
  ...props
}) {
  const e = useKpiDailyDraft({ initial, kind: "DAY", ...props }),
    [upload, setUpload] = useState(null),
    [inputError, setInputError] = useState(""),
    [historyVersion, setHistoryVersion] = useState(initial.row_version),
    fileRef = useRef(),
    readId = useRef(0);
  useEffect(
    () => () => {
      readId.current++;
    },
    [],
  );
  const disabled = !props.canWrite || e.locked,
    body = e.draft;
  const change = (k, v) => e.change((b) => ({ ...b, [k]: v }));
  function changeChannel(id, k, v) {
    e.change((b) => ({
      ...b,
      channels: b.channels.map((c) => (c.id === id ? { ...c, [k]: v } : c)),
    }));
  }
  function download() {
    const blob = new Blob([dailyCsv(body)], {
        type: "text/csv;charset=utf-8;",
      }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = `KPI-${props.date}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function uploadFile(file) {
    if (!file) return;
    const generation = ++readId.current;
    try {
      if (file.size > 100000 || !/\.(csv|tsv)$/i.test(file.name))
        throw Error("100KB 이하의 표준 CSV/TSV 양식을 사용하세요.");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer(),
      );
      if (generation !== readId.current) return;
      const next = importDailyCsv(text, body);
      setUpload({ body: next, name: file.name });
      setInputError("");
    } catch (err) {
      if (generation === readId.current) setInputError(err.message);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  function paste(event, i, j) {
    if (!/[\t\n]/.test(event.clipboardData.getData("text"))) return;
    event.preventDefault();
    try {
      e.change(pasteMetrics(body, i, j, event.clipboardData.getData("text")));
      setInputError("");
      queueMicrotask(e.flush);
    } catch (err) {
      setInputError(err.message);
    }
  }
  const save = async () => {
    await e.flush();
    setHistoryVersion((v) => (v || 0) + 1);
  };
  return (
    <section className="kd-entry" data-kpi-editor="DAY">
      <header className="kd-entry-heading">
        <div>
          <h3>
            <CalendarDays size={18} />
            {props.date.slice(5).replace("-", ".")} 실적·데일리 브리핑
          </h3>
          <p>하루 실적만 입력 · 다른 칸으로 이동하면 자동 저장 · 고객 비공개</p>
        </div>
        <div className="kd-entry-tools">
          <button onClick={download}>
            <Download size={14} /> CSV 양식
          </button>
          {props.canWrite && (
            <>
              <button
                disabled={disabled}
                onClick={() => fileRef.current.click()}
              >
                <FileUp size={14} /> 파일 업로드
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.tsv"
                hidden
                aria-label="일별 KPI CSV 업로드"
                onChange={(event) => uploadFile(event.target.files?.[0])}
              />
            </>
          )}
        </div>
      </header>
      {inputError && (
        <p className="kd-error" role="alert">
          {inputError}
        </p>
      )}
      {upload && (
        <div
          className="kd-import-review"
          role="region"
          aria-label="업로드 미리보기"
        >
          <b>
            {upload.name} · {props.date}에 적용
          </b>
          <p>
            전체 유입 {fmt(upload.body.visits)} / 전환{" "}
            {fmt(upload.body.conversions)} · 채널 {upload.body.channels.length}
            개
          </p>
          <ul>
            {upload.body.channels.map((c) => (
              <li key={c.id}>
                {c.name} · 유입 {fmt(c.visits)} · 전환 {fmt(c.conversions)} ·
                집행비 {fmt(c.cost)}
              </li>
            ))}
          </ul>
          <p>
            선택일의 숫자·채널을 교체합니다. 브리핑과 다른 날짜는 유지됩니다.
          </p>
          <button
            className="kd-primary"
            disabled={disabled}
            onClick={() => {
              e.change(upload.body);
              setUpload(null);
              queueMicrotask(save);
            }}
          >
            이 날짜에 적용
          </button>
          <button onClick={() => setUpload(null)}>취소</button>
        </div>
      )}
      <div className="kd-day-totals">
        <EditField
          label={"전체 " + settings.inflow_label}
          numeric
          value={body.visits}
          placeholder={
            stageRows.some((e) => e.stage === 2) ? "유입 시트에서 관리" : ""
          }
          onChange={(v) => change("visits", v)}
          onBlur={save}
          disabled={disabled || stageRows.some((e) => e.stage === 2)}
        />
        <EditField
          label={"전체 " + settings.conversion_label}
          numeric
          value={body.conversions}
          placeholder={
            stageRows.some((e) => e.stage === 3) ? "전환 시트에서 관리" : ""
          }
          onChange={(v) => change("conversions", v)}
          onBlur={save}
          disabled={disabled || stageRows.some((e) => e.stage === 3)}
        />
        <div>
          <b>전체 수치는 한 번만 입력</b>
          <p>
            아래 채널별 수치와 중복 합산하지 않습니다.
            <br />
            빈칸은 미확인, 실제 0건은 0을 입력하세요.
          </p>
        </div>
      </div>
      <div className="kd-input-layout">
        <div className="kd-channel-area">
          <div className="kd-section-title">
            <h4>채널별 집행·성과</h4>
            {props.canWrite && (
              <button
                disabled={disabled || body.channels.length >= 40}
                onClick={() =>
                  e.change((b) => ({
                    ...b,
                    channels: [...b.channels, channelDay(newChannel())],
                  }))
                }
              >
                <Plus size={14} /> 채널 추가
              </button>
            )}
          </div>
          <p className="kd-help">
            숫자 영역에 엑셀 여러 칸을 그대로 붙여넣을 수 있습니다. 채널별
            유입·전환은 추적 가능한 경우만 입력하세요.
          </p>
          <div className="kd-table-scroll">
            <table className="kd-channel-table">
              <thead>
                <tr>
                  <th>채널 / 유형</th>
                  {METRICS.map((k) => (
                    <th key={k}>
                      {METRIC_LABELS[k]}
                      {k === "cost" ? " (원)" : ""}
                    </th>
                  ))}
                  <th>근거 링크</th>
                  {props.canWrite && <th>관리</th>}
                </tr>
              </thead>
              <tbody>
                {body.channels.map((c, i) => (
                  <tr key={c.id}>
                    <td>
                      <input
                        aria-label={`채널 ${i + 1} 이름`}
                        value={c.name}
                        maxLength={80}
                        disabled={disabled}
                        onChange={(v) =>
                          changeChannel(c.id, "name", v.target.value)
                        }
                        onBlur={save}
                      />
                      <select
                        aria-label={`채널 ${i + 1} 유형`}
                        disabled={disabled}
                        value={c.type}
                        onChange={(v) => {
                          changeChannel(c.id, "type", v.target.value);
                          queueMicrotask(save);
                        }}
                      >
                        {Object.entries(TYPES).map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </td>
                    {METRICS.map((k, j) => (
                      <td key={k}>
                        <input
                          aria-label={`${c.name} ${METRIC_LABELS[k]}`}
                          inputMode="numeric"
                          value={c[k] ?? ""}
                          placeholder="—"
                          disabled={
                            disabled ||
                            ([
                              "cost",
                              "impressions",
                              "clicks",
                              "posts",
                            ].includes(k) &&
                              stageRows.some(
                                (e) =>
                                  e.stage === 1 &&
                                  e.source.trim().toLocaleLowerCase() ===
                                    c.name.trim().toLocaleLowerCase(),
                              ))
                          }
                          onPaste={(event) => paste(event, i, j)}
                          onChange={(v) =>
                            changeChannel(c.id, k, v.target.value)
                          }
                          onBlur={save}
                        />
                      </td>
                    ))}
                    <td>
                      <input
                        aria-label={`${c.name} 근거 링크`}
                        value={c.link}
                        placeholder="https://"
                        disabled={disabled}
                        onChange={(v) =>
                          changeChannel(c.id, "link", v.target.value)
                        }
                        onBlur={save}
                      />
                      {/^https?:\/\/\S+$/i.test(c.link) && (
                        <a
                          href={c.link}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          열기 ↗
                        </a>
                      )}
                    </td>
                    {props.canWrite && (
                      <td>
                        <button
                          disabled={disabled}
                          aria-label={`${c.name} 이 날짜에서 제거`}
                          onClick={() => {
                            if (
                              !confirm(
                                "이 날짜에서 채널과 실적을 제거할까요? 이전 값은 수정 이력에 남습니다.",
                              )
                            )
                              return;
                            e.change((b) => ({
                              ...b,
                              channels: b.channels.filter((x) => x.id !== c.id),
                            }));
                            queueMicrotask(save);
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {!body.channels.length && (
              <div className="kd-empty">
                아직 운영 채널이 없습니다. 채널을 추가하거나 CSV 양식을
                업로드하세요.
              </div>
            )}
          </div>
          {props.canWrite && body.channels.length > 0 && (
            <button
              className="kd-text-button"
              disabled={disabled}
              onClick={async () => {
                if (await e.flush())
                  onCopyRoster(
                    body.channels.map(({ id, name, type }) => ({
                      id,
                      name,
                      type,
                    })),
                  );
              }}
            >
              이 채널 목록을 다음 날짜에도 사용
            </button>
          )}
        </div>
        <aside className="kd-briefing">
          <h4>NS 데일리 브리핑</h4>
          {Object.entries(BRIEF_LABELS).map(([k, label]) => (
            <label key={k} className={"kd-brief-field " + k}>
              <span>{label}</span>
              <textarea
                aria-label={label}
                value={body[k]}
                maxLength={3000}
                disabled={disabled}
                placeholder={
                  {
                    execution: "게시·집행·수정한 내용을 짧게",
                    insight: "숫자가 변한 이유와 확인한 근거",
                    next_action: "다음에 무엇을 변경할지",
                    pocket_request: "컨펌·자료·개발 대응이 필요한 내용",
                  }[k]
                }
                onChange={(v) => change(k, v.target.value)}
                onBlur={save}
              />
            </label>
          ))}
          {onJumpTasks && (
            <button className="kd-text-button" onClick={onJumpTasks}>
              업무·확인요청으로 이동 ↗
            </button>
          )}
        </aside>
      </div>
      <SaveStatus editor={e} onReload={props.onReload} />
      <div className="kd-record-meta">
        {initial.updated_at
          ? `${initial.updated_by || "운영팀"} · ${stamp(initial.updated_at)} 갱신`
          : "아직 저장된 기록 없음"}{" "}
        · 선택일 기록만 수정됩니다.
      </div>
      {e.error?.code === "conflict" && (
        <p className="kd-error">
          입력값은 화면에 남아 있습니다. ‘입력 전체 백업’으로 숫자와 브리핑을
          보관한 뒤 ‘충돌·권한 다시 확인’을 눌러 비교하세요.
        </p>
      )}
      <History
        source={props.source}
        projectId={props.projectId}
        kind="DAY"
        date={props.date}
        version={historyVersion}
      />
    </section>
  );
}

export default function KpiDailyView({
  project,
  source,
  canWrite,
  onJumpTasks,
}) {
  const today = todayKst(),
    [month, setMonth] = useState(() => today.slice(0, 7)),
    [date, setDate] = useState(() => defaultDay(today.slice(0, 7), today)),
    [state, setState] = useState({ loading: true, data: null, error: null }),
    [revision, setRevision] = useState(0),
    [editorEpoch, setEditorEpoch] = useState(0),
    [metric, setMetric] = useState("visits"),
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
  const dates = useMemo(() => monthDays(month), [month]),
    totals = sheetStats(state.data, month, today),
    comparisons = sheetComparisons(state.data, month, settings, today),
    goals = effectiveGoals(state.data, settings),
    trendDays = sheetTrendDays(state.data),
    stageRows = [1, 2, 3].flatMap((stage) =>
      stageEntries(state.data, stage).map((e) => ({ ...e, stage })),
    ),
    selected = days.find((d) => d.date === date),
    dayMap = new Map(days.map((d) => [d.date, d]));
  const selectDate = async (value) => {
    if (value > today) return;
    if (await guard()) {
      setDate(value);
      setNotice("");
    }
  };
  const selectMonth = async (value) => {
    if (
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(value) ||
      value < "2000-01" ||
      value > "2100-12"
    )
      return;
    if (await guard()) {
      setMonth(value);
      setDate(defaultDay(value, today));
      setNotice("");
    }
  };
  const savedDay = (item) =>
    setState((s) => ({
      ...s,
      data: {
        ...s.data,
        days: [...s.data.days.filter((d) => d.date !== item.date), item].sort(
          (a, b) => a.date.localeCompare(b.date),
        ),
      },
    }));
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
  async function copyRoster(channels) {
    for (const g of guards.current.values()) if (!(await g.flush())) return;
    if (
      await guards.current
        .get("SETTINGS")
        ?.update((body) => ({ ...body, channels }))
    ) {
      setNotice(
        "운영 채널 목록을 저장했습니다. 새 날짜에 자동으로 표시됩니다.",
      );
    }
  }
  return (
    <div className="kd-workspace">
      <header className="kd-heading">
        <div>
          <span className="kd-eyebrow">
            {project.clientName || project.name}
          </span>
          <h2>KPI 성과</h2>
          <p>매일 기록하고, 누적 성과로 브리핑합니다.</p>
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
              실적 포함 {totals.recorded}일 · 기간 합계 {totals.periodCount}건 ·
              지난 날짜 미입력 {totals.missing}일
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
          <SettingsEditor
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
                    <footer>
                      {settings.inflow_source || "측정 출처를 설정해 주세요"}
                    </footer>
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
          </SettingsEditor>
          <section className="kd-trend">
            <div className="kd-section-title">
              <div>
                <h3>일별 성과 추이</h3>
                <p>
                  막대·날짜를 선택하면 해당일 기록이 열립니다. 빈 날짜는
                  미입력입니다. 기간 합계는 월 누적에만 포함되며 일별로 나누지
                  않습니다.
                </p>
              </div>
              <div className="kd-segment">
                {["visits", "conversions", "cost"].map((k) => (
                  <button
                    key={k}
                    aria-pressed={metric === k}
                    onClick={() => setMetric(k)}
                  >
                    {METRIC_LABELS[k]}
                  </button>
                ))}
              </div>
            </div>
            <Suspense
              fallback={
                <div className="kd-chart" role="status">
                  그래프 준비 중…
                </div>
              }
            >
              <Trend
                dates={dates}
                days={trendDays}
                metric={metric}
                selected={date}
                onSelect={selectDate}
              />
            </Suspense>
          </section>
          <section className="kd-dates">
            <div className="kd-section-title">
              <h3>날짜별 입력·브리핑</h3>
              <span>시트 / 기간 / 일별 기록 · 주말 포함</span>
            </div>
            <div className="kd-date-strip">
              {dates.map((d) => {
                const record = dayMap.get(d),
                  stats = dayStats(record?.body),
                  sheets = stageRows.filter((e) => d >= e.start && d <= e.end),
                  label =
                    d > today
                      ? "예정"
                      : sheets.length
                        ? sheets.some((e) => e.start !== e.end)
                          ? "기간"
                          : "시트"
                        : record
                          ? stats.complete
                            ? "완료"
                            : "일부"
                          : "미입력";
                return (
                  <button
                    key={d}
                    className={
                      label === "완료"
                        ? "complete"
                        : ["일부", "기간", "시트"].includes(label)
                          ? "partial"
                          : ""
                    }
                    aria-label={`${d} ${label}`}
                    aria-pressed={d === date}
                    disabled={d > today}
                    onClick={() => selectDate(d)}
                  >
                    <b>{Number(d.slice(8))}</b>
                    <small>
                      {label === "완료" ? <Check size={11} /> : null}
                      {label}
                    </small>
                  </button>
                );
              })}
            </div>
          </section>
          {date <= today ? (
            <>
              {[1, 2, 3].some((s) =>
                stageEntries(state.data, s).some(
                  (e) => date >= e.start && date <= e.end,
                ),
              ) && (
                <p className="kd-notice">
                  이 날짜는 단계 시트에 기록된 실적이 있습니다. 위 1·2·3 카드를
                  눌러 수정하세요. 아래 입력표에 같은 수치를 다시 입력하면 중복
                  저장이 차단됩니다. 브리핑은 아래에서 작성할 수 있습니다.
                </p>
              )}
              <DayEditor
                key={month + ":" + date + ":" + revision + ":" + editorEpoch}
                initial={
                  selected || { body: emptyDay(settings), row_version: null }
                }
                settings={settings}
                stageRows={stageRows.filter(
                  (e) => date >= e.start && date <= e.end,
                )}
                source={source}
                projectId={project.id}
                date={date}
                canWrite={writer}
                register={register}
                onSaved={savedDay}
                onReload={reloadRecords}
                onCopyRoster={copyRoster}
                onJumpTasks={
                  onJumpTasks
                    ? async () => {
                        if (await guard()) onJumpTasks();
                      }
                    : null
                }
              />
            </>
          ) : (
            <div className="kd-empty">
              미래 날짜에는 실적을 입력하지 않습니다. 목표·채널 설정은 준비할 수
              있습니다.
            </div>
          )}
          <details className="kd-ledger">
            <summary>날짜별 실적·브리핑 기록표</summary>
            <div className="kd-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>날짜</th>
                    <th>유입</th>
                    <th>전환</th>
                    <th>집행비</th>
                    <th>입력 상태</th>
                    <th>작성자 / 최근 수정</th>
                  </tr>
                </thead>
                <tbody>
                  {dates
                    .filter((d) => d <= today)
                    .map((d) => {
                      const row = dayMap.get(d),
                        sheets = stageRows.filter(
                          (e) => d >= e.start && d <= e.end,
                        ),
                        s = dayStats(trendDays.find((r) => r.date === d)?.body),
                        metricText = (key, stage) =>
                          sheets.some(
                            (e) => e.stage === stage && e.start !== e.end,
                          )
                            ? s[key] == null
                              ? "기간 합계에 포함"
                              : fmt(s[key]) + " + 기간 별도"
                            : fmt(s[key]);
                      return (
                        <tr key={d}>
                          <td>
                            <button onClick={() => selectDate(d)}>
                              {d.slice(5)}
                            </button>
                          </td>
                          <td>{metricText("visits", 2)}</td>
                          <td>{metricText("conversions", 3)}</td>
                          <td>{metricText("cost", 1)}</td>
                          <td>
                            {sheets.length
                              ? "단계 시트 기록"
                              : !row
                                ? "미입력"
                                : s.complete
                                  ? "완료"
                                  : "일부 입력"}
                          </td>
                          <td>
                            {row
                              ? `${row.updated_by || "운영팀"} · ${stamp(row.updated_at)}`
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </details>
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
