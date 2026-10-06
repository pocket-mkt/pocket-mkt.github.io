export const METRICS = [
  "cost",
  "impressions",
  "clicks",
  "posts",
  "visits",
  "conversions",
];
export const sameDaily = (a, b) => {
  const normalize = (value) =>
    Array.isArray(value)
      ? value.map(normalize)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, normalize(value[key])]),
          )
        : value;
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
};
export const METRIC_LABELS = {
  cost: "집행비",
  impressions: "노출·조회",
  clicks: "클릭",
  posts: "발행",
  visits: "유입",
  conversions: "전환",
};
export const BRIEF_LABELS = {
  execution: "실행 내용",
  insight: "성과 해석",
  next_action: "다음 액션",
  pocket_request: "포켓 확인사항",
};
export const todayKst = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const shiftDay = (date, n) =>
  new Date(Date.parse(date + "T00:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
export const monthDays = (month) => {
  const n = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
  ).getUTCDate();
  return Array.from(
    { length: n },
    (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`,
  );
};
export function defaultDay(month, today = todayKst()) {
  const yesterday = shiftDay(today, -1),
    days = monthDays(month);
  return yesterday.startsWith(month)
    ? yesterday
    : month === today.slice(0, 7)
      ? today
      : days.at(-1);
}
export const defaultSettings = () => ({
  inflow_label: "홈페이지 유입",
  conversion_label: "최종 전환",
  inflow_goal: null,
  conversion_goal: null,
  inflow_source: "",
  conversion_source: "",
  definition: "",
  rate_enabled: false,
  channels: [],
});
export const newChannel = (
  name = "새 채널",
  type = "AD",
  id = crypto.randomUUID(),
) => ({ id, name, type });
export const channelDay = (c) => ({
  id: c.id,
  name: c.name,
  type: c.type,
  ...Object.fromEntries(METRICS.map((k) => [k, null])),
  link: "",
});
export const emptyDay = (settings = defaultSettings()) => ({
  visits: null,
  conversions: null,
  channels: settings.channels.map(channelDay),
  execution: "",
  insight: "",
  next_action: "",
  pocket_request: "",
});
export function numberValue(raw, goal = false) {
  if (raw == null || String(raw).trim() === "") return null;
  const str = String(raw).trim().replaceAll(",", "");
  if (!/^\d+$/.test(str)) throw Error("숫자는 0 이상의 정수로 입력하세요.");
  const n = Number(str);
  if (!Number.isSafeInteger(n) || n > 1e9 || n < (goal ? 1 : 0))
    throw Error(
      goal
        ? "목표는 1~10억 사이의 정수로 입력하세요."
        : "숫자는 0~10억 사이로 입력하세요.",
    );
  return n;
}
export function validateDaily(kind, body) {
  if (kind === "SETTINGS") {
    for (const key of [
      "inflow_label",
      "conversion_label",
      "inflow_source",
      "conversion_source",
      "definition",
    ])
      if (typeof body[key] !== "string" || body[key].length > 200)
        throw Error("설정 텍스트는 200자까지 입력하세요.");
    if (!body.inflow_label.trim() || !body.conversion_label.trim())
      throw Error("유입·전환 이름을 입력하세요.");
    numberValue(body.inflow_goal, true);
    numberValue(body.conversion_goal, true);
    if (
      body.rate_enabled &&
      (!body.inflow_source.trim() ||
        !body.conversion_source.trim() ||
        !body.definition.trim())
    )
      throw Error(
        "전환율을 표시하려면 두 데이터 출처와 집계 기준을 입력하세요.",
      );
  } else {
    numberValue(body.visits);
    numberValue(body.conversions);
    for (const key of Object.keys(BRIEF_LABELS))
      if (typeof body[key] !== "string" || body[key].length > 3000)
        throw Error("브리핑은 항목별 3,000자까지 입력하세요.");
  }
  if (!Array.isArray(body.channels) || body.channels.length > 40)
    throw Error("채널은 최대 40개까지 가능합니다.");
  if (new Set(body.channels.map((c) => c.id)).size !== body.channels.length)
    throw Error("중복된 채널입니다.");
  for (const c of body.channels) {
    if (
      !/^[a-zA-Z0-9_-]{1,60}$/.test(c.id) ||
      !c.name?.trim() ||
      c.name.length > 80 ||
      !["AD", "CONTENT", "OTHER"].includes(c.type)
    )
      throw Error("채널 이름·유형을 확인하세요.");
    if (kind === "DAY") {
      METRICS.forEach((k) => numberValue(c[k]));
      if (
        typeof c.link !== "string" ||
        c.link.length > 2000 ||
        (c.link && !/^https?:\/\/\S+$/i.test(c.link))
      )
        throw Error("근거 링크는 http(s) 주소로 입력하세요.");
    }
  }
  return body;
}
const knownSum = (values) =>
  values.some((v) => v != null)
    ? values.reduce((n, v) => n + (v ?? 0), 0)
    : null;
export function dayStats(body) {
  if (!body)
    return {
      visits: null,
      conversions: null,
      cost: null,
      posts: null,
      impressions: null,
      complete: false,
      costComplete: false,
    };
  const costComplete =
    body.channels.some((c) => c.cost != null) &&
    body.channels.filter((c) => c.type === "AD").every((c) => c.cost != null);
  return {
    visits: body.visits,
    conversions: body.conversions,
    cost: knownSum(body.channels.map((c) => c.cost)),
    posts: knownSum(body.channels.map((c) => c.posts)),
    impressions: knownSum(body.channels.map((c) => c.impressions)),
    costComplete,
    complete:
      body.visits != null &&
      body.conversions != null &&
      body.channels.filter((c) => c.type === "AD").every((c) => c.cost != null),
  };
}
export function monthlyStats(days, month, today = todayKst()) {
  const expected = monthDays(month).filter((d) => d < today);
  const rows = days.filter((r) => r.date.startsWith(month) && r.date <= today);
  const stats = rows.map((r) => dayStats(r.body));
  const visits = knownSum(stats.map((s) => s.visits)),
    conversions = knownSum(stats.map((s) => s.conversions)),
    cost = knownSum(stats.map((s) => s.cost));
  const paired =
    stats.length > 0 &&
    stats.every((s) => s.visits != null && s.conversions != null);
  return {
    visits,
    conversions,
    cost,
    posts: knownSum(stats.map((s) => s.posts)),
    impressions: knownSum(stats.map((s) => s.impressions)),
    recorded: rows.length,
    complete: stats.filter((s) => s.complete).length,
    missing: expected.filter((d) => !rows.some((r) => r.date === d)).length,
    partial:
      expected.some((d) => !rows.some((r) => r.date === d)) ||
      stats.some((s) => !s.complete),
    rate: paired && visits > 0 ? (conversions / visits) * 100 : null,
    unitCost:
      paired && conversions > 0 && stats.every((s) => s.costComplete)
        ? cost / conversions
        : null,
  };
}
export function recordDiff(before, after) {
  const changes = [];
  for (const key of Object.keys(after)) {
    if (key === "channels") {
      const previous = new Map((before?.channels || []).map((c) => [c.id, c]));
      for (const c of after.channels) {
        const old = previous.get(c.id);
        previous.delete(c.id);
        if (!old) {
          changes.push({
            label: `${c.name} 추가`,
            before: null,
            after:
              METRICS.filter((k) => c[k] != null)
                .map((k) => `${METRIC_LABELS[k]} ${c[k]}`)
                .join(" · ") || c.type,
          });
          continue;
        }
        for (const f of ["name", "type", ...METRICS, "link"])
          if (old[f] !== c[f] && c[f] !== undefined)
            changes.push({
              label: `${c.name} · ${METRIC_LABELS[f] || { name: "이름", type: "유형", link: "근거 링크" }[f]}`,
              before: old[f],
              after: c[f],
            });
      }
      for (const c of previous.values())
        changes.push({ label: `${c.name} 제거`, before: c.name, after: null });
    } else if (before?.[key] !== after[key])
      changes.push({
        label:
          BRIEF_LABELS[key] ||
          {
            visits: "전체 유입",
            conversions: "전체 전환",
            inflow_label: "유입 이름",
            conversion_label: "전환 이름",
            inflow_goal: "유입 목표",
            conversion_goal: "전환 목표",
            inflow_source: "유입 출처",
            conversion_source: "전환 출처",
            definition: "집계 기준",
            rate_enabled: "전환율 표시",
          }[key] ||
          key,
        before: before?.[key],
        after: after[key],
      });
  }
  return changes;
}
export const CSV_HEADER = [
  "구분",
  "채널",
  "유형",
  "집행비",
  "노출·조회",
  "클릭",
  "발행",
  "유입",
  "전환",
  "링크",
];
// Strict standard CSV/TSV only. Source-specific ad exports are not guessed.
export function parseDelimited(text, separator = ",") {
  if (text.length > 100000) throw Error("파일은 100KB 이하만 가능합니다.");
  const rows = [];
  let row = [],
    value = "",
    quoted = false,
    closed = false;
  text = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === undefined) throw Error("따옴표가 닫히지 않았습니다.");
      if (c === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else value += c;
      continue;
    }
    if (c === separator || c === "\n" || c === undefined) {
      row.push(value);
      value = "";
      closed = false;
      if (c !== separator) {
        if (row.some((x) => x !== "")) rows.push(row);
        row = [];
      }
      continue;
    }
    if (closed) throw Error("파일 구분 형식을 확인하세요.");
    if (c === '"') {
      if (value) throw Error("잘못된 따옴표입니다.");
      quoted = true;
    } else value += c;
  }
  return rows;
}
const csvCell = (s) => '"' + String(s ?? "").replaceAll('"', '""') + '"';
export function dailyCsv(body) {
  const rows = [
    CSV_HEADER,
    [
      "전체",
      "전체 집계",
      "",
      null,
      null,
      null,
      null,
      body.visits,
      body.conversions,
      "",
    ],
    ...body.channels.map((c) => [
      "채널",
      c.name,
      c.type,
      ...METRICS.map((k) => c[k]),
      c.link,
    ]),
  ];
  // Text values beginning with spreadsheet formula characters are escaped on export.
  return (
    "\uFEFF" +
    rows
      .map((r) =>
        r
          .map((v) =>
            csvCell(typeof v === "string" && /^[=+@-]/.test(v) ? "'" + v : v),
          )
          .join(","),
      )
      .join("\r\n")
  );
}
export function importDailyCsv(text, current) {
  const separator = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)[0]
    .includes("\t")
    ? "\t"
    : ",";
  const rows = parseDelimited(text, separator);
  if (
    JSON.stringify(rows.shift()) !== JSON.stringify(CSV_HEADER) ||
    rows.length > 41
  )
    throw Error("제공된 표준 양식(최대 40개 채널)을 사용하세요.");
  const total = rows.filter((r) => r[0] === "전체");
  if (
    total.length !== 1 ||
    rows.some((r) => r.length !== 10 || !["전체", "채널"].includes(r[0]))
  )
    throw Error("전체 집계 1행과 채널 행을 확인하세요.");
  const seen = new Set();
  const channels = rows
    .filter((r) => r[0] === "채널")
    .map((r) => {
      const name =
        r[1].startsWith("'") && /^[=+@-]/.test(r[1].slice(1))
          ? r[1].slice(1)
          : r[1];
      const key = name.trim();
      if (seen.has(key))
        throw Error("같은 이름의 채널을 중복 업로드할 수 없습니다.");
      seen.add(key);
      const old = current.channels.find((c) => c.name === name);
      return {
        ...channelDay(newChannel(name, r[2], old?.id)),
        ...Object.fromEntries(
          METRICS.map((k, i) => [k, numberValue(r[i + 3])]),
        ),
        link: r[9],
      };
    });
  return validateDaily("DAY", {
    ...current,
    visits: numberValue(total[0][7]),
    conversions: numberValue(total[0][8]),
    channels,
  });
}
export function pasteMetrics(body, rowIndex, columnIndex, text) {
  const grid = parseDelimited(text, "\t");
  if (
    !grid.length ||
    rowIndex + grid.length > body.channels.length ||
    grid.some((r) => columnIndex + r.length > METRICS.length)
  )
    throw Error("붙여넣을 범위가 표를 벗어납니다. 숫자 영역만 복사하세요.");
  const next = structuredClone(body);
  grid.forEach((r, i) =>
    r.forEach(
      (value, j) =>
        (next.channels[rowIndex + i][METRICS[columnIndex + j]] =
          numberValue(value)),
    ),
  );
  return validateDaily("DAY", next);
}
