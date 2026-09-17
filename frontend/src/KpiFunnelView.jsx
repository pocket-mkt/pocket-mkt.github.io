import { useEffect, useRef, useState, useMemo } from "react";
import {
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Info,
  RotateCcw,
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
import "./kpiDirectFunnel.css";
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
  const activeChannel =
    body.channels.find((c) => c.id === selected) || body.channels[0];
  const activeRate =
    activeChannel?.visits > 0 && activeChannel.conversions != null
      ? (activeChannel.conversions / activeChannel.visits) * 100
      : null;
  const saveFunnelMetric = (key, value) =>
    activeChannel
      ? changeChannel(activeChannel.id, key, value)
      : save((b) => ({
          ...b,
          channels: [
            ...b.channels,
            {
              id: crypto.randomUUID(),
              name: "직접 입력",
              type: "OTHER",
              visits: null,
              conversions: null,
              cost: null,
              [key]: value,
            },
          ],
        }));
  const funnelInput = (key, label) =>
    write ? (
      <Cell
        key={"funnel-" + key}
        value={activeChannel?.[key] ?? null}
        label={label}
        disabled={busy}
        dirty={dirtyFor("funnel-" + key)}
        onSave={(v) => saveFunnelMetric(key, v)}
      />
    ) : (
      <strong className="kf-direct-number">{fmt(activeChannel?.[key])}</strong>
    );
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
              <section className="kf-direct">
                <header>
                  <div>
                    <h3>성과 퍼널</h3>
                    <p>
                      채널을 선택하고 깔때기 안의 숫자를 수정하세요. Enter 또는
                      다른 칸 클릭 시 저장됩니다.
                    </p>
                  </div>
                  <span>월 누적 · 직접 입력</span>
                </header>
                <div className="kf-funnel-editor">
                  <div className="kf-funnel-step source">
                    <span className="kf-step-no">01 · 광고·콘텐츠</span>
                    <label>수정할 채널</label>
                    {body.channels.length ? (
                      <select
                        aria-label="퍼널 채널"
                        disabled={busy}
                        value={activeChannel.id}
                        onChange={(e) => {
                          if (discard()) {
                            dirtySet.current.clear();
                            setSelected(e.target.value);
                          }
                        }}
                      >
                        {body.channels.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <strong>첫 번째 채널</strong>
                    )}
                    {write ? (
                      <Cell
                        key="funnel-name"
                        value={activeChannel?.name || ""}
                        label="퍼널 채널 이름"
                        type="text"
                        disabled={busy}
                        dirty={dirtyFor("funnel-name")}
                        onSave={(v) => saveFunnelMetric("name", v)}
                      />
                    ) : (
                      <strong>{activeChannel?.name || "—"}</strong>
                    )}
                    <small>
                      {body.channels.length
                        ? "선택한 채널의 유입·전환을 수정합니다."
                        : "채널명이나 숫자 입력 시 첫 채널이 등록됩니다."}
                    </small>
                  </div>
                  <div className="kf-funnel-step traffic">
                    <span className="kf-step-no">02 · 유입</span>
                    {field("inflow_label", "유입 단계 이름")}
                    {funnelInput("visits", "퍼널 유입 수")}
                    <small>선택 채널 유입 수</small>
                    <label>
                      전체 유입 목표{" "}
                      {field("inflow_goal", "유입 목표", {
                        goal: true,
                        type: "number",
                      })}
                    </label>
                  </div>
                  <div className="kf-funnel-step conversion">
                    <span className="kf-step-no">03 · 전환</span>
                    {field("name", "최종 KPI 이름")}
                    {funnelInput("conversions", "퍼널 전환 수")}
                    <small>선택 채널 전환 수</small>
                    <label>
                      전체 전환 목표{" "}
                      {field("goal", "전환 목표", {
                        goal: true,
                        type: "number",
                      })}
                    </label>
                  </div>
                </div>
                <div className="kf-funnel-results" aria-live="polite">
                  <div>
                    <span>선택 채널 전환율</span>
                    <strong>
                      {activeRate == null ? "—" : activeRate.toFixed(1) + "%"}
                    </strong>
                    <small>전환 ÷ 유입 × 100</small>
                  </div>
                  <div>
                    <span>전체 유입 목표 달성률</span>
                    <strong>
                      {totals.visits !== null && body.inflow_goal
                        ? ((totals.visits / body.inflow_goal) * 100).toFixed(
                            1,
                          ) + "%"
                        : "—"}
                    </strong>
                    <small>
                      {fmt(totals.visits)} / 목표 {fmt(body.inflow_goal)}
                    </small>
                  </div>
                  <div>
                    <span>전체 전환 목표 달성률</span>
                    <strong>{percent == null ? "—" : percent + "%"}</strong>
                    <small>
                      {fmt(totals.conversions)} / 목표 {fmt(body.goal)}
                    </small>
                  </div>
                  <div>
                    <span>전체 전환율</span>
                    <strong>
                      {totals.rate == null ? "—" : totals.rate.toFixed(1) + "%"}
                    </strong>
                    <small>모든 채널 합산 · {fmt(totals.conversions)}건</small>
                  </div>
                </div>
                <p className="kf-note">
                  <Info size={13} />
                  퍼널 폭은 단계 구분용입니다. 실제 비율은 아래 수치로
                  확인하세요. 빈칸은 미입력이며, 전체 합계는 모든 채널 입력 후
                  계산됩니다.
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
