import {
  defaultDay,
  emptyDay,
  monthDays,
  numberValue,
  todayKst,
} from "./kpiDailyModel.js";

export const STAGES = ["광고·콘텐츠", "유입", "전환"];
export const GOAL_METRICS = {
  cost: "집행비",
  impressions: "노출·조회",
  clicks: "클릭",
  posts: "발행",
  visits: "유입",
  conversions: "전환",
};
export const stageOf = (metric) =>
  metric === "visits" ? 2 : metric === "conversions" ? 3 : 1;
export const stageEntries = (data, stage) =>
  data?.stage_sheets?.[`STAGE_${stage}`]?.body.entries || [];
export const stageFields = (stage) =>
  stage === 1 ? ["cost", "impressions", "clicks", "posts"] : ["value"];
export function newStageEntry(stage, month, settings, today = todayKst()) {
  const date = defaultDay(month, today);
  return {
    id: crypto.randomUUID(),
    start: date,
    end: date,
    source:
      stage === 1
        ? settings.channels[0]?.name || ""
        : stage === 2
          ? settings.inflow_source
          : settings.conversion_source,
    note: "",
    ...Object.fromEntries(stageFields(stage).map((k) => [k, null])),
  };
}
export function normalizeStageEntry(stage, entry, month, today = todayKst()) {
  const days = monthDays(month);
  if (
    !days.includes(entry.start) ||
    !days.includes(entry.end) ||
    entry.start > entry.end ||
    entry.end > today
  )
    throw Error(
      "선택한 월 안에서 오늘까지의 날짜·기간을 지정하세요. 월을 넘는 실적은 월별로 나눠 입력하세요.",
    );
  if (!entry.source.trim() || entry.source.length > 80)
    throw Error(
      stage === 1
        ? "채널 이름을 입력하세요. (80자 이내)"
        : "측정 출처를 입력하세요. (80자 이내)",
    );
  if (entry.note.length > 500) throw Error("메모는 500자까지 입력하세요.");
  const result = { ...entry, source: entry.source.trim() };
  stageFields(stage).forEach((k) => {
    result[k] = numberValue(entry[k]);
  });
  if (!stageFields(stage).some((k) => result[k] != null))
    throw Error("실적을 하나 이상 입력하세요. 실적이 없으면 0을 입력하세요.");
  return result;
}
const intersects = (a, b) => a.start <= b.end && b.start <= a.end;
const sameSource = (a, b) =>
  a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
export function checkStageOverlap(stage, entries, days) {
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (
      entries
        .slice(i + 1)
        .some(
          (other) =>
            intersects(e, other) &&
            (stage !== 1 || sameSource(e.source, other.source)),
        )
    )
      throw Error(
        "이미 기록된 기간과 겹칩니다. 기존 기록을 수정하거나 겹치지 않는 날짜를 선택하세요.",
      );
    if (
      days.some(
        (r) =>
          r.date >= e.start &&
          r.date <= e.end &&
          (stage === 1
            ? r.body.channels.some(
                (c) =>
                  sameSource(c.name, e.source) &&
                  stageFields(1).some((k) => c[k] != null),
              )
            : r.body[stage === 2 ? "visits" : "conversions"] != null),
      )
    )
      throw Error(
        "아래 일별 입력표에 같은 날짜의 실적이 있습니다. 기존 일별 기록을 수정해 주세요.",
      );
  }
  if (entries.length > 250)
    throw Error("단계별 월 최대 250개 기록까지 입력할 수 있습니다.");
}
export function effectiveGoals(data, settings) {
  if (data?.goals) return data.goals.body.goals;
  return [
    ["visits", settings.inflow_goal, settings.inflow_label],
    ["conversions", settings.conversion_goal, settings.conversion_label],
  ]
    .filter(([, target]) => target != null)
    .map(([metric, target, title]) => ({
      id: `legacy_${metric}`,
      metric,
      target,
      title,
      direction: "AT_LEAST",
    }));
}
export function normalizeGoals(goals) {
  if (goals.length > 5)
    throw Error("목표는 프로젝트·월별로 최대 5개까지 설정할 수 있습니다.");
  return goals.map((g) => {
    if (
      !g.title.trim() ||
      g.title.length > 80 ||
      !GOAL_METRICS[g.metric] ||
      !["AT_LEAST", "AT_MOST"].includes(g.direction)
    )
      throw Error("목표 이름·지표·조건을 확인하세요.");
    const target = numberValue(g.target, true);
    if (target == null) throw Error("목표값을 입력하세요.");
    return { ...g, title: g.title.trim(), target };
  });
}
export function goalResult(goal, actual) {
  if (actual == null) return { met: null, percent: null };
  return {
    met:
      goal.direction === "AT_MOST"
        ? actual <= goal.target
        : actual >= goal.target,
    percent: (actual / goal.target) * 100,
  };
}
const sum = (values) =>
  values.some((v) => v != null)
    ? values.reduce((n, v) => n + (v ?? 0), 0)
    : null;
export function sheetStats(data, month, today = todayKst()) {
  const days = (data?.days || []).filter(
    (r) => r.date.startsWith(month) && r.date <= today,
  );
  const dates = monthDays(month).filter((d) => d <= today),
    values = {},
    coverage = {};
  for (const metric of Object.keys(GOAL_METRICS)) {
    const stage = stageOf(metric),
      entries = stageEntries(data, stage);
    const points = days
      .map((r) => ({
        start: r.date,
        end: r.date,
        value:
          stage === 1
            ? sum(r.body.channels.map((c) => c[metric]))
            : r.body[metric],
      }))
      .concat(
        entries.map((e) => ({
          start: e.start,
          end: e.end,
          value: e[stage === 1 ? metric : "value"],
        })),
      );
    values[metric] = sum(points.map((p) => p.value));
    coverage[metric] = new Set(
      dates.filter((d) =>
        points.some((p) => p.value != null && d >= p.start && d <= p.end),
      ),
    );
  }
  const matching = (a, b) =>
    a.size > 0 && a.size === b.size && [...a].every((d) => b.has(d));
  const recorded = dates.filter((d) =>
    Object.values(coverage).some((s) => s.has(d)),
  ).length;
  const complete = dates.filter(
    (d) =>
      coverage.visits.has(d) &&
      coverage.conversions.has(d) &&
      coverage.cost.has(d),
  ).length;
  const costComplete =
    stageEntries(data, 1).every((e) => e.cost != null) &&
    days.every((r) =>
      r.body.channels
        .filter((c) => c.type === "AD")
        .every((c) => c.cost != null),
    );
  return {
    ...values,
    recorded,
    complete,
    missing: dates.filter(
      (d) => d < today && !Object.values(coverage).some((s) => s.has(d)),
    ).length,
    partial: complete < dates.filter((d) => d < today).length,
    rate:
      matching(coverage.visits, coverage.conversions) && values.visits > 0
        ? (values.conversions / values.visits) * 100
        : null,
    unitCost:
      costComplete &&
      matching(coverage.cost, coverage.conversions) &&
      values.conversions > 0
        ? values.cost / values.conversions
        : null,
    periodCount: [1, 2, 3]
      .flatMap((s) => stageEntries(data, s))
      .filter((e) => e.start !== e.end).length,
  };
}
// Period totals are deliberately absent from daily bars: never invent a daily split.
export function sheetTrendDays(data) {
  const map = new Map(
    (data?.days || []).map((r) => [r.date, structuredClone(r)]),
  );
  for (const stage of [1, 2, 3])
    for (const e of stageEntries(data, stage)) {
      if (e.start !== e.end) continue;
      if (!map.has(e.start))
        map.set(e.start, { date: e.start, body: emptyDay() });
      const b = map.get(e.start).body;
      if (stage === 1)
        b.channels.push({
          id: e.id,
          name: e.source,
          type: "AD",
          ...Object.fromEntries(stageFields(1).map((k) => [k, e[k]])),
          visits: null,
          conversions: null,
          link: "",
        });
      else b[stage === 2 ? "visits" : "conversions"] = e.value;
    }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}
