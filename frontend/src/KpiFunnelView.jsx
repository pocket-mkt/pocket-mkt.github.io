import { lazy, Suspense, useEffect, useRef, useState, useMemo } from "react";
import {
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Info,
  RotateCcw,
  Target,
  Eye,
} from "lucide-react";
import {
  emptyFunnel,
  monthNow,
  moveMonth,
  metricValue,
  validateFunnel,
  funnelTotals,
} from "./kpiFunnelModel.js";
import "./kpiFunnel.css";
const Chart = lazy(() => import("./KpiFunnelChart.jsx"));
const fmt = (v, suffix = "") =>
  v == null ? "—" : v.toLocaleString("ko-KR") + suffix;
function Cell({
  value,
  label,
  onSave,
  disabled,
  type = "number",
  goal = false,
  dirty,
}) {
  const [draft, setDraft] = useState(value ?? ""),
    [error, setError] = useState("");
  const editing = useRef(false),
    saving = useRef(false),
    cancel = useRef(false);
  useEffect(() => {
    if (!editing.current) {
      setDraft(value ?? "");
      setError("");
    }
  }, [value]);
  const commit = async () => {
    if (cancel.current) {
      cancel.current = false;
      return;
    }
    if (saving.current || String(draft) === String(value ?? "")) {
      if (!saving.current) {
        editing.current = false;
        dirty(false);
      }
      return;
    }
    saving.current = true;
    setError("");
    try {
      const v = type === "number" ? metricValue(draft, { goal }) : draft.trim();
      if (type === "text" && !v) throw Error("내용을 입력해 주세요.");
      await onSave(v);
      editing.current = false;
      dirty(false);
    } catch (e) {
      setError(e.message);
    } finally {
      saving.current = false;
    }
  };
  return (
    <div className={"kf-cell " + (error ? "has-error" : "")}>
      <input
        aria-label={label}
        title={label + " · Enter 또는 다른 칸 클릭 시 저장"}
        type={type}
        min={goal ? 1 : 0}
        max={1000000000}
        step="1"
        maxLength={type === "text" ? 200 : undefined}
        placeholder={type === "text" ? "입력" : "미입력"}
        value={draft}
        disabled={disabled}
        onInput={(e) => {
          editing.current = true;
          dirty(true);
          setDraft(e.currentTarget.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            cancel.current = true;
            editing.current = false;
            dirty(false);
            setDraft(value ?? "");
            setError("");
            e.currentTarget.blur();
          }
        }}
      />
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
export default function KpiFunnelView({
  project,
  source,
  legacy,
  legacyError,
  canWrite: allowedWrite,
}) {
  const [month, setMonth] = useState(monthNow),
    [state, setState] = useState({ status: "loading" }),
    [revision, refresh] = useState(0),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [selected, setSelected] = useState(null),
    [preview, setPreview] = useState(false),
    [adding, setAdding] = useState(false),
    [newName, setNewName] = useState(""),
    [newType, setNewType] = useState("AD"),
    [sort, setSort] = useState("default");
  const generation = useRef(0),
    locked = useRef(false),
    dirtySet = useRef(new Set()),
    canonical = useRef(null),
    request = useRef(null);
  useEffect(() => {
    const ctrl = new AbortController(),
      g = ++generation.current;
    setState({ status: "loading" });
    canonical.current = null;
    source
      .kpiFunnel({ projectId: project.id, month, signal: ctrl.signal })
      .then((r) => {
        if (g === generation.current && !ctrl.signal.aborted) {
          canonical.current = r.data;
          setState({ status: "ready", ...r.data });
        }
      })
      .catch((e) => {
        if (!ctrl.signal.aborted && g === generation.current)
          setState({ status: "error", error: e });
      });
    return () => {
      ctrl.abort();
      generation.current++;
    };
  }, [source, project.id, month, revision]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        !locked.current &&
        !dirtySet.current.size &&
        !document.activeElement?.matches("input,select")
      )
        refresh((n) => n + 1);
    }, 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const handler = (e) => {
      if (locked.current || dirtySet.current.size) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);
  const body = state.item?.body || emptyFunnel(),
    totals = useMemo(() => funnelTotals(body.channels), [body.channels]);
  const write = !!allowedWrite && !!state.canWrite && !preview;
  const internal = !!state.internal && !preview;
  const dirtyFor = (key) => (yes) => {
    if (yes) dirtySet.current.add(key);
    else dirtySet.current.delete(key);
  };
  const discard = () =>
    !dirtySet.current.size ||
    window.confirm("저장하지 못했거나 수정 중인 입력을 버리고 이동할까요?");
  const reload = () => {
    if (discard()) {
      dirtySet.current.clear();
      refresh((n) => n + 1);
    }
  };
  const save = async (transform) => {
    if (locked.current)
      throw Error("다른 항목을 저장 중입니다. 잠시 후 다시 시도하세요.");
    if (!write) throw Error("수정 권한이 없습니다.");
    const base = canonical.current,
      item = base?.item;
    const next = validateFunnel(
      transform(structuredClone(item?.body || emptyFunnel())),
    );
    const fingerprint = JSON.stringify([
      project.id,
      month,
      item?.row_version,
      next,
    ]);
    if (request.current?.fingerprint !== fingerprint)
      request.current = { fingerprint, id: crypto.randomUUID() };
    locked.current = true;
    setBusy(true);
    setNotice("저장 중…");
    const g = generation.current;
    try {
      const r = await source.saveKpiFunnel({
        projectId: project.id,
        month,
        body: next,
        rowVersion: item?.row_version,
        mutationId: request.current.id,
      });
      if (g === generation.current) {
        canonical.current = r.data;
        setState({ status: "ready", ...r.data });
        setNotice("저장 완료");
        request.current = null;
      }
      return r;
    } catch (e) {
      if (g === generation.current) setNotice(e.message);
      throw e;
    } finally {
      locked.current = false;
      if (g === generation.current) setBusy(false);
    }
  };
  const field = (key, label, { goal = false, type = "text" } = {}) =>
    write ? (
      <Cell
        key={key}
        value={body[key]}
        label={label}
        type={type}
        goal={goal}
        disabled={busy}
        dirty={dirtyFor(key)}
        onSave={(v) => save((b) => ({ ...b, [key]: v }))}
      />
    ) : (
      <strong>{type === "number" ? fmt(body[key]) : body[key]}</strong>
    );
  const changeChannel = (id, key, value) =>
    save((b) => ({
      ...b,
      channels: b.channels.map((c) =>
        c.id === id ? { ...c, [key]: value } : c,
      ),
    }));
  const selectedRow = body.channels.find((c) => c.id === selected);
  const percent =
    totals.conversions !== null && body.goal
      ? Math.round((totals.conversions / body.goal) * 100)
      : null;
  const channels = [...body.channels].sort((a, b) =>
    sort === "conversion"
      ? (b.conversions ?? -1) - (a.conversions ?? -1)
      : sort === "visits"
        ? (b.visits ?? -1) - (a.visits ?? -1)
        : 0,
  );
  return (
    <div className="kf-view">
      <header className="kf-heading">
        <div>
          <h2>KPI 성과</h2>
          <p>
            {project.clientName || project.name} · 광고·콘텐츠 → 전체 유입 →
            전환
          </p>
        </div>
        <div className="kf-controls">
          <button
            aria-label="이전 달"
            disabled={busy || month <= "2000-01"}
            onClick={() => {
              if (discard()) {
                dirtySet.current.clear();
                setMonth(moveMonth(month, -1));
                setSelected(null);
              }
            }}
          >
            <ChevronLeft size={16} />
          </button>
          <input
            aria-label="집계 월"
            type="month"
            min="2000-01"
            max="2100-12"
            disabled={busy}
            value={month}
            onChange={(e) => {
              if (e.target.value && discard()) {
                dirtySet.current.clear();
                setMonth(e.target.value);
                setSelected(null);
              }
            }}
          />
          <button
            aria-label="다음 달"
            disabled={busy || month >= "2100-12"}
            onClick={() => {
              if (discard()) {
                dirtySet.current.clear();
                setMonth(moveMonth(month, 1));
                setSelected(null);
              }
            }}
          >
            <ChevronRight size={16} />
          </button>
          {state.internal && (
            <button
              aria-pressed={preview}
              disabled={busy}
              onClick={() => {
                if (discard()) {
                  dirtySet.current.clear();
                  setPreview((p) => !p);
                  refresh((n) => n + 1);
                }
              }}
            >
              <Eye size={15} />
              {preview ? "내부 편집" : "고객사 미리보기"}
            </button>
          )}
        </div>
      </header>
      {state.status === "loading" ? (
        <p role="status">KPI 성과를 불러오는 중입니다…</p>
      ) : state.status === "error" ? (
        <div role="alert">
          {state.error.message}
          <button onClick={reload}>다시 시도</button>
        </div>
      ) : (
        <>
          <div className="kf-status">
            <span role="status">
              {notice || "월별 누적 실적 · 직접 입력 · 자동 수집 미연결"}
            </span>
            {state.item && (
              <span>
                수정{" "}
                {new Date(state.item.updated_at).toLocaleString("ko-KR", {
                  timeZone: "Asia/Seoul",
                })}
              </span>
            )}
            <button disabled={busy} onClick={reload}>
              <RotateCcw size={12} />
              최신 내용
            </button>
          </div>
          {!state.item && !write ? (
            <div className="kf-empty">
              공개된 KPI 실적이 없습니다. 운영팀이 실적을 등록하고 공개하면
              표시됩니다.
            </div>
          ) : (
            <>
              <section className="kf-goal">
                <div>
                  <label>
                    <Target size={14} />
                    최종 KPI
                  </label>
                  {field("name", "최종 KPI 이름")}
                  <div className="kf-number">
                    {fmt(totals.conversions)}
                    <small>건</small>
                  </div>
                </div>
                <div>
                  <label>전환 목표 · 월간</label>
                  {field("goal", "전환 목표", { goal: true, type: "number" })}
                  <p>
                    {percent == null
                      ? "목표·실적 입력 후 달성률 표시"
                      : `${percent}% 달성 · ${fmt(Math.max(0, body.goal - totals.conversions))}건 남음`}
                  </p>
                  <progress
                    aria-label="전환 목표 달성률"
                    value={Math.min(percent || 0, 100)}
                    max="100"
                  />
                </div>
                <div>
                  <label>유입 목표 · 월간</label>
                  {field("inflow_goal", "유입 목표", {
                    goal: true,
                    type: "number",
                  })}
                  <p>
                    현재 {fmt(totals.visits)} / 목표 {fmt(body.inflow_goal)}
                  </p>
                </div>
                <div>
                  <label>전체 전환율</label>
                  <div className="kf-number small">
                    {totals.rate == null ? "—" : totals.rate.toFixed(1) + "%"}
                  </div>
                  {internal && (
                    <p>
                      광고 전환당 비용{" "}
                      {fmt(
                        totals.paidCost == null
                          ? null
                          : Math.round(totals.paidCost),
                        "원",
                      )}
                    </p>
                  )}
                </div>
              </section>
              <section className="kf-flow">
                <header>
                  <h3>성과 흐름</h3>
                  <span>
                    {write
                      ? "숫자·이름을 수정하고 Enter 또는 다른 칸을 누르면 저장됩니다."
                      : "선택한 월의 누적 실적"}
                  </span>
                </header>
                <div className="kf-flow-scroll">
                  <div className="kf-flow-inner">
                    <div className="kf-stages">
                      <div>
                        광고·콘텐츠<small>{body.channels.length}개 채널</small>
                      </div>
                      <div>
                        {field("inflow_label", "유입 단계 이름")}
                        <small>{fmt(totals.visits)} 유입</small>
                      </div>
                      <div>
                        {body.name}
                        <small>{fmt(totals.conversions)}건 전환</small>
                      </div>
                    </div>
                    {totals.visits > 0 && totals.conversions !== null ? (
                      <Suspense
                        fallback={
                          <p className="kf-empty">
                            그래프를 준비하고 있습니다…
                          </p>
                        }
                      >
                        <Chart
                          channels={body.channels}
                          totals={totals}
                          name={body.name}
                          inflow={body.inflow_label}
                          selected={selected}
                          onSelect={(id) =>
                            setSelected((v) => (v === id ? null : id))
                          }
                        />
                      </Suspense>
                    ) : (
                      <p className="kf-empty">
                        {body.channels.length
                          ? "모든 채널의 유입·전환을 입력하면 흐름이 표시됩니다. 0과 미입력은 구분됩니다."
                          : "아래에서 채널을 추가하고 실적을 입력해 주세요."}
                      </p>
                    )}
                  </div>
                </div>
                {selectedRow && (
                  <div className="kf-selection">
                    <b>{selectedRow.name}</b> 유입 {fmt(selectedRow.visits)} →{" "}
                    {body.name} {fmt(selectedRow.conversions, "건")}
                    <button onClick={() => setSelected(null)}>전체 보기</button>
                  </div>
                )}
                <p className="kf-note">
                  <Info size={13} />
                  동일 기간·측정 기준의 유입/전환만 입력하세요. 노출·조회 수는
                  유입에 합산하지 않습니다. 선은 입력값 기준이며 실제 사용자
                  경로 추적이 아닙니다.
                </p>
              </section>
              <section className="kf-table-panel">
                <header>
                  <div>
                    <h3>채널별 성과</h3>
                    <span>빈칸은 미입력 · 확인한 0은 숫자 0으로 입력</span>
                  </div>
                  <div>
                    <select
                      aria-label="채널 정렬"
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                    >
                      <option value="default">기본 순서</option>
                      <option value="conversion">전환 많은 순</option>
                      <option value="visits">유입 많은 순</option>
                    </select>
                    {write && (
                      <button
                        disabled={busy || body.channels.length >= 40}
                        onClick={() => setAdding((a) => !a)}
                      >
                        <Plus size={14} />
                        채널 추가
                      </button>
                    )}
                  </div>
                </header>
                {adding && write && (
                  <form
                    className="kf-add"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      try {
                        await save((b) => ({
                          ...b,
                          channels: [
                            ...b.channels,
                            {
                              id: crypto.randomUUID(),
                              name: newName.trim(),
                              type: newType,
                              visits: null,
                              conversions: null,
                              cost: null,
                            },
                          ],
                        }));
                        setNewName("");
                        setAdding(false);
                      } catch {}
                    }}
                  >
                    <input
                      aria-label="새 채널 이름"
                      placeholder="채널명 직접 입력"
                      maxLength="80"
                      required
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                    />
                    <select
                      aria-label="새 채널 유형"
                      value={newType}
                      onChange={(e) => setNewType(e.target.value)}
                    >
                      <option value="AD">광고</option>
                      <option value="CONTENT">콘텐츠</option>
                      <option value="OTHER">기타</option>
                    </select>
                    <button disabled={busy || !newName.trim()}>추가</button>
                    <button type="button" onClick={() => setAdding(false)}>
                      취소
                    </button>
                  </form>
                )}
                <div className="kf-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>채널 · 이름 수정</th>
                        <th>유형</th>
                        <th>유입</th>
                        <th>{body.name}</th>
                        <th>전환율</th>
                        {internal && <th>광고비 (원)</th>}
                        {write && <th>관리</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {channels.map((c) => (
                        <tr
                          key={c.id}
                          className={selected === c.id ? "selected" : ""}
                        >
                          <td>
                            {write ? (
                              <Cell
                                value={c.name}
                                label={c.name + " 이름"}
                                type="text"
                                disabled={busy}
                                dirty={dirtyFor(c.id + "name")}
                                onSave={(v) => changeChannel(c.id, "name", v)}
                              />
                            ) : (
                              <button
                                onClick={() =>
                                  setSelected((v) => (v === c.id ? null : c.id))
                                }
                              >
                                {c.name}
                              </button>
                            )}
                          </td>
                          <td>
                            {write ? (
                              <select
                                aria-label={c.name + " 유형"}
                                disabled={busy}
                                value={c.type}
                                onChange={(e) =>
                                  changeChannel(
                                    c.id,
                                    "type",
                                    e.target.value,
                                  ).catch(() => {})
                                }
                              >
                                <option value="AD">광고</option>
                                <option value="CONTENT">콘텐츠</option>
                                <option value="OTHER">기타</option>
                              </select>
                            ) : (
                              { AD: "광고", CONTENT: "콘텐츠", OTHER: "기타" }[
                                c.type
                              ]
                            )}
                          </td>
                          {[
                            "visits",
                            "conversions",
                            ...(internal ? ["cost"] : []),
                          ]
                            .slice(0, 2)
                            .map((k, i) => (
                              <td key={k}>
                                {write ? (
                                  <Cell
                                    value={c[k]}
                                    label={c.name + " " + (i ? "전환" : "유입")}
                                    disabled={busy}
                                    dirty={dirtyFor(c.id + k)}
                                    onSave={(v) => changeChannel(c.id, k, v)}
                                  />
                                ) : (
                                  fmt(c[k])
                                )}
                              </td>
                            ))}
                          <td>
                            {c.visits > 0 && c.conversions !== null
                              ? ((c.conversions / c.visits) * 100).toFixed(1) +
                                "%"
                              : "—"}
                          </td>
                          {internal && (
                            <td>
                              {write ? (
                                <Cell
                                  value={c.cost}
                                  label={c.name + " 광고비"}
                                  disabled={busy}
                                  dirty={dirtyFor(c.id + "cost")}
                                  onSave={(v) => changeChannel(c.id, "cost", v)}
                                />
                              ) : (
                                fmt(c.cost)
                              )}
                            </td>
                          )}
                          {write && (
                            <td>
                              <button
                                aria-label={c.name + " 삭제"}
                                disabled={busy}
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `‘${c.name}’의 ${month} 실적을 목록에서 삭제할까요? 다른 월은 유지되고 삭제 전 값은 변경 이력에 보관됩니다.`,
                                    )
                                  )
                                    save((b) => ({
                                      ...b,
                                      channels: b.channels.filter(
                                        (x) => x.id !== c.id,
                                      ),
                                    })).catch(() => {});
                                }}
                              >
                                <Trash2 size={14} />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th>합계</th>
                        <td />
                        <td>{fmt(totals.visits)}</td>
                        <td>{fmt(totals.conversions)}</td>
                        <td>
                          {totals.rate == null
                            ? "—"
                            : totals.rate.toFixed(1) + "%"}
                        </td>
                        {internal && <td>{fmt(totals.cost)}</td>}
                        {write && <td />}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </section>
              <section className="kf-settings">
                <label>집계 기준{field("definition", "집계 기준")}</label>
                {write && (
                  <label className="kf-publish">
                    <input
                      type="checkbox"
                      checked={body.customer_visible}
                      disabled={busy}
                      onChange={(e) => {
                        const value = e.target.checked;
                        if (
                          !value ||
                          window.confirm(
                            "이 월의 목표·채널·유입·전환을 KPI 조회 권한이 있는 고객사에 공개할까요? 광고비는 공개되지 않습니다.",
                          )
                        )
                          save((b) => ({
                            ...b,
                            customer_visible: value,
                          })).catch(() => {});
                      }}
                    />
                    고객사에 공개
                    <small>기존 KPI 접근 권한 필요 · 광고비는 내부 전용</small>
                  </label>
                )}
              </section>
            </>
          )}
        </>
      )}
      {legacy && (
        <details className="kf-legacy">
          <summary>기존 KPI 기록 · 별도 원장 유지</summary>
          {legacy}
        </details>
      )}
      {legacyError && <p>기존 KPI 기록을 불러오지 못했습니다.</p>}
    </div>
  );
}
