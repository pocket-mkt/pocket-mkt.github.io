import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, X, Pencil, Trash2 } from "lucide-react";
import { useDialogSurface } from "./useDialogSurface.js";
import { sameDaily, todayKst, monthDays } from "./kpiDailyModel.js";
import KpiDelta from "./KpiDelta.jsx";
import {
  STAGES,
  GOAL_METRICS,
  stageOf,
  stageFields,
  newStageEntry,
  normalizeStageEntry,
  checkStageOverlap,
  normalizeGoals,
  goalResult,
} from "./kpiStageModel.js";
import "./kpiStageSheets.css";
const fmt = (v) =>
  v == null
    ? "—"
    : Number(v).toLocaleString("ko-KR", { maximumFractionDigits: 1 });

export function StageGoals({ goals, totals, stage, comparisons }) {
  return (
    <div className="ks-card-goals">
      {goals
        .filter((g) => stageOf(g.metric) === stage)
        .map((g) => {
          const actual = totals[g.metric],
            r = goalResult(g, actual);
          return (
            <div className="ks-goal-preview" key={g.id}>
              <div>
                <span>{g.title}</span>
                <b className={r.met == null ? "" : r.met ? "met" : "unmet"}>
                  {r.met == null ? "미입력" : r.met ? "충족" : "미달"} ·{" "}
                  {fmt(actual)} / {fmt(g.target)}
                  {g.metric === "cost" ? "원" : ""}
                </b>
              </div>
              {comparisons && (
                <KpiDelta
                  metric={g.metric}
                  comparison={comparisons[g.metric]}
                />
              )}
              <div
                className="ks-meter"
                role="progressbar"
                aria-label={`${g.title} ${g.direction === "AT_MOST" ? "한도 사용률" : "달성률"}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={
                  r.percent == null ? undefined : Math.min(100, r.percent)
                }
              >
                <i style={{ width: `${Math.min(100, r.percent || 0)}%` }} />
              </div>
              <small>
                {GOAL_METRICS[g.metric]} {fmt(g.target)}{" "}
                {g.direction === "AT_MOST" ? "이하" : "이상"} ·{" "}
                {r.percent == null
                  ? "실적 입력 후 계산"
                  : `${g.direction === "AT_MOST" ? "한도 사용" : "달성률"} ${fmt(r.percent)}%`}
              </small>
            </div>
          );
        })}
    </div>
  );
}

export default function KpiStageSheets({
  stage,
  month,
  initial,
  goals,
  settings,
  days,
  source,
  projectId,
  canWrite,
  onSaved,
  onClose,
  onStageChange,
  onReload,
  register,
  History,
}) {
  const isGoals = stage === "GOALS",
    kind = isGoals ? "GOALS" : `STAGE_${stage}`,
    date = month + "-01";
  const [record, setRecord] = useState(initial),
    [entry, setEntry] = useState(() =>
      isGoals ? null : newStageEntry(stage, month, settings),
    ),
    [goalDraft, setGoals] = useState(() => structuredClone(goals)),
    [mode, setMode] = useState("day"),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(null),
    [message, setMessage] = useState("");
  const surface = useRef(null),
    pending = useRef(null),
    busyRef = useRef(false),
    latest = useRef({});
  const baseline = useRef(isGoals ? structuredClone(goals) : entry);
  const dirty = isGoals
    ? !sameDaily(goalDraft, baseline.current)
    : !sameDaily(entry, baseline.current);
  latest.current = { dirty, busy, error, entry, goalDraft };
  const close = useCallback(() => {
    if (busyRef.current) return;
    if (
      (latest.current.dirty || pending.current) &&
      !window.confirm("저장되지 않은 입력을 버리고 닫을까요?")
    )
      return;
    onClose();
  }, [onClose]);
  useDialogSurface(true, surface, close);
  useEffect(() => {
    if (!isGoals && onStageChange)
      surface.current
        ?.querySelector('.ks-stage-picker [aria-pressed="true"]')
        ?.focus();
  }, [stage, isGoals, onStageChange]);
  useEffect(
    () =>
      register("SHEET", {
        dirty: () => latest.current.dirty || !!pending.current,
        pending: () => busyRef.current,
        flush: async () => !latest.current.dirty && !pending.current,
      }),
    [register],
  );
  const entries = record?.body.entries || [],
    blocked = error?.code === "conflict" || error?.code === "forbidden",
    locked = busy || !!pending.current || blocked;
  function changeStage(next) {
    if (next === stage || busyRef.current || pending.current) return;
    if (
      dirty &&
      !window.confirm(`저장하지 않은 입력을 버리고 ${next}단계로 이동할까요?`)
    )
      return;
    onStageChange?.(next);
  }
  function resetEntry() {
    const next = newStageEntry(stage, month, settings);
    setEntry(next);
    baseline.current = next;
    setEditing(false);
    setMode("day");
  }
  function edit(e) {
    if (
      dirty &&
      !window.confirm("작성 중인 입력을 버리고 이 기록을 수정할까요?")
    )
      return;
    const next = structuredClone(e);
    setEntry(next);
    baseline.current = next;
    setEditing(true);
    setMode(e.start === e.end ? "day" : "range");
    setError(null);
    setMessage("");
    surface.current
      ?.querySelector(".ks-body")
      ?.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function persist(body) {
    if (busyRef.current || blocked) return;
    if (!pending.current)
      pending.current = {
        projectId,
        kind,
        date,
        body,
        rowVersion: record?.row_version ?? null,
        mutationId: crypto.randomUUID(),
      };
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setMessage("");
    try {
      const request = pending.current,
        result = await source.saveKpiDaily(request),
        item = result.data.item;
      if (!sameDaily(item.body, request.body))
        throw Object.assign(
          Error(
            "다른 사용자의 최신 수정이 있습니다. 입력을 백업하고 최신 기록과 비교해 주세요.",
          ),
          { code: "conflict" },
        );
      setRecord(item);
      onSaved(kind, item);
      pending.current = null;
      if (isGoals) {
        setGoals(item.body.goals);
        baseline.current = item.body.goals;
      } else resetEntry();
      setMessage(
        isGoals
          ? "목표가 저장되었습니다."
          : "기록이 저장되어 누적 성과에 반영되었습니다.",
      );
    } catch (e) {
      if (["22023", "23P01", "conflict", "forbidden"].includes(e.code))
        pending.current = null;
      setError(e);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function submit(event) {
    event.preventDefault();
    if (pending.current) return persist();
    try {
      if (isGoals) return persist({ goals: normalizeGoals(goalDraft) });
      const next = normalizeStageEntry(stage, entry, month);
      const all = editing
        ? entries.map((e) => (e.id === next.id ? next : e))
        : [...entries, next];
      checkStageOverlap(stage, all, days);
      return persist({ entries: all });
    } catch (e) {
      setError(e);
    }
  }
  function remove(e) {
    if (dirty && !window.confirm("작성 중인 입력을 버리고 삭제할까요?")) return;
    if (
      window.confirm(
        `${e.start} ~ ${e.end} 기록을 삭제할까요? 누적에서 제외되며 수정 이력은 남습니다.`,
      )
    )
      persist({ entries: entries.filter((x) => x.id !== e.id) });
  }
  function backup() {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              projectId,
              kind,
              date,
              draft: isGoals ? goalDraft : entry,
              pending: pending.current,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `KPI-${kind}-${month}-입력백업.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const update = (k, v) =>
    setEntry((e) => ({
      ...e,
      [k]: v,
      ...(k === "start" && mode === "day" ? { end: v } : {}),
    }));
  const maxDate = [monthDays(month).at(-1), todayKst()].sort()[0];
  return (
    <div
      className="ks-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        className="ks-dialog"
        ref={surface}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ks-title"
        tabIndex={-1}
        data-kpi-editor="SHEET"
      >
        <header className="ks-heading">
          <div>
            <span>
              {month.replace("-", "년 ")}월 ·{" "}
              {isGoals ? "프로젝트 목표" : "단계별 누적 기록"}
            </span>
            <h2 id="ks-title">
              {isGoals ? "목표 설정" : canWrite ? "데이터 입력" : "입력 기록"}
            </h2>
          </div>
          <button
            type="button"
            data-dialog-close
            aria-label="시트 닫기"
            disabled={busy}
            onClick={close}
          >
            <X size={19} />
          </button>
        </header>
        {!isGoals && onStageChange && (
          <div
            className="ks-stage-picker"
            role="group"
            aria-label="입력 단계 선택"
          >
            {STAGES.map((name, i) => (
              <button
                key={name}
                type="button"
                aria-label={`${i + 1}단계 ${name} 선택`}
                aria-pressed={stage === i + 1}
                disabled={busy || !!pending.current}
                onClick={() => changeStage(i + 1)}
              >
                <span>{i + 1}단계</span>
                <b>{name}</b>
              </button>
            ))}
          </div>
        )}
        <div className="ks-body">
          <p className="ks-intro">
            {isGoals
              ? "이 프로젝트의 이번 달 목표를 최대 5개까지 설정합니다. 저장된 실적으로 달성 여부가 자동 계산됩니다."
              : stage === 1
                ? "채널별 실적을 날짜 또는 기간 단위로 추가하세요. 입력한 기간의 합계가 한 번만 누적됩니다."
                : "전체 실적을 날짜 또는 기간 단위로 추가하세요. 같은 날짜를 중복 입력할 수 없습니다."}
          </p>
          {canWrite ? (
            <form id="ks-form" onSubmit={submit}>
              {isGoals ? (
                <div className="ks-goals-editor">
                  {goalDraft.map((g, i) => (
                    <fieldset
                      key={g.id}
                      disabled={locked}
                      className="ks-goal-edit"
                    >
                      <legend>목표 {i + 1}</legend>
                      <label>
                        목표 이름
                        <input
                          aria-label={`목표 ${i + 1} 이름`}
                          maxLength={80}
                          placeholder="예: 월 예약 30건"
                          value={g.title}
                          onChange={(e) =>
                            setGoals((gs) =>
                              gs.map((x) =>
                                x.id === g.id
                                  ? { ...x, title: e.target.value }
                                  : x,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        연결 지표
                        <select
                          aria-label={`목표 ${i + 1} 지표`}
                          value={g.metric}
                          onChange={(e) =>
                            setGoals((gs) =>
                              gs.map((x) =>
                                x.id === g.id
                                  ? { ...x, metric: e.target.value }
                                  : x,
                              ),
                            )
                          }
                        >
                          {Object.entries(GOAL_METRICS).map(([key, label]) => (
                            <option key={key} value={key}>
                              {stageOf(key)}단계 · {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        목표값
                        <input
                          aria-label={`목표 ${i + 1} 값`}
                          inputMode="numeric"
                          value={g.target ?? ""}
                          onChange={(e) =>
                            setGoals((gs) =>
                              gs.map((x) =>
                                x.id === g.id
                                  ? { ...x, target: e.target.value }
                                  : x,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        조건
                        <select
                          aria-label={`목표 ${i + 1} 조건`}
                          value={g.direction}
                          onChange={(e) =>
                            setGoals((gs) =>
                              gs.map((x) =>
                                x.id === g.id
                                  ? { ...x, direction: e.target.value }
                                  : x,
                              ),
                            )
                          }
                        >
                          <option value="AT_LEAST">이상 달성</option>
                          <option value="AT_MOST">이하 유지</option>
                        </select>
                      </label>
                      <button
                        type="button"
                        aria-label={`목표 ${i + 1} 제거`}
                        onClick={() =>
                          setGoals((gs) => gs.filter((x) => x.id !== g.id))
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    </fieldset>
                  ))}
                  <button
                    type="button"
                    className="ks-add-goal"
                    disabled={locked || goalDraft.length >= 5}
                    onClick={() =>
                      setGoals((gs) => [
                        ...gs,
                        {
                          id: crypto.randomUUID(),
                          title: "",
                          metric: "conversions",
                          target: null,
                          direction: "AT_LEAST",
                        },
                      ])
                    }
                  >
                    <Plus size={15} /> 목표 추가 <b>{goalDraft.length}/5</b>
                  </button>
                </div>
              ) : (
                <fieldset className="ks-entry-form" disabled={locked}>
                  <div className="ks-date-mode">
                    <button
                      type="button"
                      aria-pressed={mode === "day"}
                      onClick={() => {
                        setMode("day");
                        setEntry((e) => ({ ...e, end: e.start }));
                      }}
                    >
                      날짜 지정
                    </button>
                    <button
                      type="button"
                      aria-pressed={mode === "range"}
                      onClick={() => setMode("range")}
                    >
                      기간 지정
                    </button>
                    <span>{editing ? "기존 기록 수정" : "새 기록 추가"}</span>
                  </div>
                  <div className={`ks-form-grid ${mode}`}>
                    <label>
                      {mode === "day" ? "날짜" : "시작일"}
                      <input
                        aria-label="실적 시작일"
                        type="date"
                        min={date}
                        max={maxDate}
                        value={entry.start}
                        onChange={(e) => update("start", e.target.value)}
                      />
                    </label>
                    {mode === "range" && (
                      <label>
                        종료일
                        <input
                          aria-label="실적 종료일"
                          type="date"
                          min={entry.start || date}
                          max={maxDate}
                          value={entry.end}
                          onChange={(e) => update("end", e.target.value)}
                        />
                      </label>
                    )}
                    <label className="ks-source">
                      {stage === 1 ? "채널" : "측정 출처"}
                      <input
                        aria-label={
                          stage === 1 ? "실적 채널" : "실적 측정 출처"
                        }
                        list={stage === 1 ? "ks-channel-options" : undefined}
                        maxLength={80}
                        placeholder={
                          stage === 1
                            ? "예: 네이버 검색광고"
                            : "예: GA4 / 예약 관리자"
                        }
                        value={entry.source}
                        onChange={(e) => update("source", e.target.value)}
                      />
                    </label>
                    <datalist id="ks-channel-options">
                      {settings.channels.map((c) => (
                        <option value={c.name} key={c.id} />
                      ))}
                    </datalist>
                  </div>
                  <div className="ks-metrics">
                    {stageFields(stage).map((k) => (
                      <label key={k}>
                        {k === "value"
                          ? stage === 2
                            ? settings.inflow_label
                            : settings.conversion_label
                          : GOAL_METRICS[k]}
                        <input
                          aria-label={`실적 ${k === "value" ? STAGES[stage - 1] : GOAL_METRICS[k]}`}
                          inputMode="numeric"
                          placeholder="미입력"
                          value={entry[k] ?? ""}
                          onChange={(e) => update(k, e.target.value)}
                        />
                        <small>
                          {mode === "range" ? "선택 기간 합계" : "당일 실적"}
                          {k === "cost" ? " · 원" : " · 건"}
                        </small>
                      </label>
                    ))}
                  </div>
                  <label>
                    메모
                    <textarea
                      aria-label="실적 메모"
                      maxLength={500}
                      rows={2}
                      placeholder="실행 내용이나 수치의 근거를 남겨 주세요."
                      value={entry.note}
                      onChange={(e) => update("note", e.target.value)}
                    />
                  </label>
                </fieldset>
              )}
            </form>
          ) : isGoals ? (
            <ul>
              {goals.map((g) => (
                <li key={g.id}>
                  {g.title} · {GOAL_METRICS[g.metric]} {fmt(g.target)}{" "}
                  {g.direction === "AT_MOST" ? "이하" : "이상"}
                </li>
              ))}
            </ul>
          ) : null}
          {!isGoals && (
            <section className="ks-records">
              <header>
                <h3>
                  누적 기록 <b>{entries.length}</b>
                </h3>
                <span>최신 날짜순 · 기간 합계는 일별로 나누지 않음</span>
              </header>
              {entries.length ? (
                <div className="ks-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>날짜·기간</th>
                        <th>{stage === 1 ? "채널" : "출처"}</th>
                        {stageFields(stage).map((k) => (
                          <th key={k}>
                            {k === "value"
                              ? STAGES[stage - 1]
                              : GOAL_METRICS[k]}
                          </th>
                        ))}
                        <th>메모</th>
                        {canWrite && <th>관리</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {[...entries]
                        .sort(
                          (a, b) =>
                            b.start.localeCompare(a.start) ||
                            b.end.localeCompare(a.end),
                        )
                        .map((e) => (
                          <tr key={e.id}>
                            <td>
                              {e.start.slice(5)}
                              {e.start !== e.end && (
                                <>
                                  {" "}
                                  ~ {e.end.slice(5)}
                                  <small>기간 합계</small>
                                </>
                              )}
                            </td>
                            <td>{e.source}</td>
                            {stageFields(stage).map((k) => (
                              <td key={k} className="ks-number">
                                {fmt(e[k])}
                              </td>
                            ))}
                            <td className="ks-note">{e.note || "—"}</td>
                            {canWrite && (
                              <td>
                                <div className="ks-row-actions">
                                  <button
                                    type="button"
                                    disabled={locked}
                                    aria-label={`${e.start} ${e.source} 수정`}
                                    onClick={() => edit(e)}
                                  >
                                    <Pencil size={14} />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={locked}
                                    aria-label={`${e.start} ${e.source} 삭제`}
                                    onClick={() => remove(e)}
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </td>
                            )}
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="ks-empty">
                  아직 기록이 없습니다. 첫 실적을 입력하면 이곳에 쌓입니다.
                </p>
              )}
              {days.some((r) =>
                stage === 1
                  ? r.body.channels.some((c) =>
                      stageFields(1).some((k) => c[k] != null),
                    )
                  : r.body[stage === 2 ? "visits" : "conversions"] != null,
              ) && (
                <p className="ks-legacy-note">
                  기존 일별 실적도 누적과 추이에 포함됩니다. 같은 날짜·채널의
                  실적을 다시 추가하면 중복 저장이 차단됩니다.
                </p>
              )}
            </section>
          )}
          {History && (
            <History
              source={source}
              projectId={projectId}
              kind={kind}
              date={date}
              version={record?.row_version}
            />
          )}
        </div>
        <footer className="ks-footer">
          <div aria-live="polite">
            {error ? (
              <>
                <p role="alert">{error.message}</p>
                <button type="button" onClick={backup}>
                  입력 백업
                </button>
                {blocked && (
                  <>
                    <small>입력을 백업한 뒤 충돌·권한을 다시 확인하세요.</small>
                    {onReload && (
                      <button type="button" onClick={onReload}>
                        충돌·권한 다시 확인
                      </button>
                    )}
                  </>
                )}
              </>
            ) : (
              <span>
                {busy
                  ? "저장 중…"
                  : message || "저장한 뒤 누적·목표 달성률에 반영됩니다."}
              </span>
            )}
          </div>
          <div className="ks-footer-actions">
            {editing && (
              <button
                type="button"
                disabled={locked}
                onClick={() => {
                  if (
                    !dirty ||
                    window.confirm("변경을 버리고 새 기록을 입력할까요?")
                  )
                    resetEntry();
                }}
              >
                수정 취소
              </button>
            )}
            {canWrite && (
              <button
                type="submit"
                form="ks-form"
                className="kd-primary"
                disabled={busy || blocked}
              >
                {busy
                  ? "저장 중…"
                  : pending.current
                    ? "저장 재시도"
                    : isGoals
                      ? "목표 저장"
                      : editing
                        ? "수정 저장"
                        : "기록 추가"}
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}
