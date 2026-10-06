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
  monthlyStats,
  newChannel,
  pasteMetrics,
  recordDiff,
  todayKst,
} from "./kpiDailyModel.js";
import { moveMonth } from "./kpiFunnelModel.js";
import { useKpiDailyDraft } from "./useKpiDailyDraft.js";
import "./kpiDaily.css";
const Trend = lazy(() => import("./KpiDailyTrend.jsx"));
const fmt = (v) =>
  v == null
    ? "—"
    : Number(v).toLocaleString("ko-KR", { maximumFractionDigits: 1 });
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

function SaveStatus({ editor }) {
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

function SettingsEditor({ initial, ...props }) {
  const e = useKpiDailyDraft({ initial, kind: "SETTINGS", ...props }),
    disabled = !props.canWrite || e.locked;
  const change = (k, v) => e.change((b) => ({ ...b, [k]: v }));
  return (
    <details className="kd-settings">
      <summary>
        <Settings2 size={15} /> 이번 달 목표·측정 기준·운영 채널
      </summary>
      <div data-kpi-editor="SETTINGS">
        <p>
          이 설정은 이번 달에만 적용됩니다. 기존 일별 실적의 숫자와 채널 기록은
          바뀌지 않습니다.
        </p>
        <div className="kd-settings-grid">
          {[
            ["inflow_label", "유입 이름"],
            ["conversion_label", "전환 이름"],
            ["inflow_goal", "월 유입 목표"],
            ["conversion_goal", "월 전환 목표"],
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
          동일한 기간·범위의 유입과 전환으로 비율 표시 (사람별 경로 추적은 아님)
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
        <SaveStatus editor={e} />
      </div>
      <History
        source={props.source}
        projectId={props.projectId}
        kind="SETTINGS"
        date={props.date}
        version={initial.row_version}
      />
    </details>
  );
}

function DayEditor({ initial, settings, onJumpTasks, onCopyRoster, ...props }) {
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
          onChange={(v) => change("visits", v)}
          onBlur={save}
          disabled={disabled}
        />
        <EditField
          label={"전체 " + settings.conversion_label}
          numeric
          value={body.conversions}
          onChange={(v) => change("conversions", v)}
          onBlur={save}
          disabled={disabled}
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
                          disabled={disabled}
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
      <SaveStatus editor={e} />
      <div className="kd-record-meta">
        {initial.updated_at
          ? `${initial.updated_by || "운영팀"} · ${stamp(initial.updated_at)} 갱신`
          : "아직 저장된 기록 없음"}{" "}
        · 선택일 기록만 수정됩니다.
      </div>
      {e.error?.code === "conflict" && (
        <p className="kd-error">
          입력값은 화면에 남아 있습니다. ‘입력 전체 백업’으로 숫자와 브리핑을
          보관한 뒤 상단 ‘최신 기록’을 눌러 비교하세요.
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
  onLegacy,
  onJumpTasks,
}) {
  const today = todayKst(),
    [month, setMonth] = useState(() => today.slice(0, 7)),
    [date, setDate] = useState(() => defaultDay(today.slice(0, 7), today)),
    [state, setState] = useState({ loading: true, data: null, error: null }),
    [revision, setRevision] = useState(0),
    [editorEpoch, setEditorEpoch] = useState(0),
    [metric, setMetric] = useState("visits"),
    [notice, setNotice] = useState("");
  const guards = useRef(new Map()),
    loadGeneration = useRef(0);
  const latestState = useRef(state);
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
    totals = monthlyStats(days, month, today),
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
          <button
            onClick={async () => {
              if (await guard()) setRevision((r) => r + 1);
            }}
          >
            최신 기록
          </button>
          {onLegacy && (
            <button
              onClick={async () => {
                if (await guard()) onLegacy(month);
              }}
            >
              기존 월별 자료
            </button>
          )}
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
              <b>{month.replace("-", "년 ")}월 누적</b> · 저장된 일별 실적 기준
            </span>
            <span className={totals.partial ? "kd-partial" : ""}>
              입력 {totals.recorded}일 · 완료 {totals.complete}일 · 지난 날짜
              미입력 {totals.missing}일{totals.partial ? " · 부분 집계" : ""}
            </span>
          </div>
          {state.data.legacy_exists && (
            <p className="kd-legacy-note">
              이달의 기존 월별 자료가 있습니다. 일별 합계에 더하지 않으며 ‘기존
              월별 자료’에서 확인할 수 있습니다.
            </p>
          )}
          <div className="kd-funnel">
            <article className="kd-stage marketing">
              <header>
                <span>1</span>
                <h3>광고·콘텐츠</h3>
              </header>
              <p className="kd-metric-caption">누적 집행비</p>
              <strong>
                {fmt(totals.cost)}
                <small>원</small>
              </strong>
              <footer>
                <span>
                  발행 <b>{fmt(totals.posts)}건</b>
                </span>
                <span>
                  노출·조회 <b>{fmt(totals.impressions)}</b>
                </span>
              </footer>
            </article>
            <ArrowRight className="kd-arrow" size={20} />
            <article className="kd-stage traffic">
              <header>
                <span>2</span>
                <h3>유입</h3>
              </header>
              <p className="kd-metric-caption">{settings.inflow_label}</p>
              <strong>
                {fmt(totals.visits)}
                <small>건</small>
              </strong>
              <Goal actual={totals.visits} goal={settings.inflow_goal} />
              <footer>
                {settings.inflow_source || "측정 출처를 설정해 주세요"}
              </footer>
            </article>
            <ArrowRight className="kd-arrow" size={20} />
            <article className="kd-stage conversion">
              <header>
                <span>3</span>
                <h3>전환</h3>
              </header>
              <p className="kd-metric-caption">{settings.conversion_label}</p>
              <strong>
                {fmt(totals.conversions)}
                <small>건</small>
              </strong>
              <Goal
                actual={totals.conversions}
                goal={settings.conversion_goal}
              />
              <footer>
                <span>
                  유입 대비{" "}
                  <b>
                    {settings.rate_enabled && totals.rate != null
                      ? fmt(totals.rate) + "%"
                      : "기준 확인 필요"}
                  </b>
                </span>
                <span>
                  집행비 / 전체 전환 <b>{fmt(totals.unitCost)}원</b>
                </span>
              </footer>
            </article>
          </div>
          <p className="kd-help">
            누적은 입력된 날짜만 합산합니다. 채널별 유입·전환은 전체 수치에
            더하지 않습니다. 미확인 값은 0으로 처리하지 않습니다.
          </p>
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
          />
          <section className="kd-trend">
            <div className="kd-section-title">
              <div>
                <h3>일별 성과 추이</h3>
                <p>
                  막대·날짜를 선택하면 해당일 기록이 열립니다. 빈 날짜는
                  미입력입니다.
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
                days={days}
                metric={metric}
                selected={date}
                onSelect={selectDate}
              />
            </Suspense>
          </section>
          <section className="kd-dates">
            <div className="kd-section-title">
              <h3>날짜별 입력·브리핑</h3>
              <span>완료 / 일부 / 미입력 · 주말 포함</span>
            </div>
            <div className="kd-date-strip">
              {dates.map((d) => {
                const record = dayMap.get(d),
                  stats = dayStats(record?.body),
                  label =
                    d > today
                      ? "예정"
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
                        : label === "일부"
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
            <DayEditor
              key={month + ":" + date + ":" + revision + ":" + editorEpoch}
              initial={
                selected || { body: emptyDay(settings), row_version: null }
              }
              settings={settings}
              source={source}
              projectId={project.id}
              date={date}
              canWrite={writer}
              register={register}
              onSaved={savedDay}
              onCopyRoster={copyRoster}
              onJumpTasks={
                onJumpTasks
                  ? async () => {
                      if (await guard()) onJumpTasks();
                    }
                  : null
              }
            />
          ) : (
            <div className="kd-empty">
              미래 날짜에는 실적을 입력하지 않습니다. 목표·채널 설정은 준비할 수
              있습니다.
            </div>
          )}
          <details className="kd-ledger">
            <summary>월 전체 일별 기록표</summary>
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
                        s = dayStats(row?.body);
                      return (
                        <tr key={d}>
                          <td>
                            <button onClick={() => selectDate(d)}>
                              {d.slice(5)}
                            </button>
                          </td>
                          <td>{fmt(s.visits)}</td>
                          <td>{fmt(s.conversions)}</td>
                          <td>{fmt(s.cost)}</td>
                          <td>
                            {!row
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
        </>
      )}
    </div>
  );
}
function Goal({ actual, goal }) {
  const percent = goal && actual != null ? (actual / goal) * 100 : null;
  return (
    <div className="kd-goal">
      <div>
        <span>월 목표 {fmt(goal)}</span>
        <b>
          {percent == null
            ? goal
              ? "실적 미입력"
              : "목표 미설정"
            : fmt(percent) + "%"}
        </b>
      </div>
      <div
        className="kd-progress"
        role="progressbar"
        aria-label="월 목표 달성률"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent == null ? undefined : Math.min(100, percent)}
      >
        <i
          style={{
            width: (percent == null ? 0 : Math.min(100, percent)) + "%",
          }}
        />
      </div>
    </div>
  );
}
