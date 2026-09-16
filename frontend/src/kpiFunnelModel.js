export const emptyFunnel = () => ({
  name: "예약 확정",
  goal: null,
  inflow_label: "전체 유입",
  inflow_goal: null,
  definition: "중복·취소를 제외한 확정 건수",
  customer_visible: false,
  channels: [],
});
export const monthNow = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
export function moveMonth(month, by) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}
export function metricValue(value, { goal = false } = {}) {
  if (value === "" || value == null) return null;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < (goal ? 1 : 0) || n > 1000000000)
    throw Error(
      goal
        ? "목표는 1 이상의 정수로 입력하세요."
        : "0 이상의 정수로 입력하세요.",
    );
  return n;
}
export function validateFunnel(body) {
  for (const k of ["name", "inflow_label", "definition"])
    if (!String(body[k] || "").trim() || body[k].length > 200)
      throw Error("KPI 이름·유입 이름·집계 기준을 입력해 주세요.");
  for (const k of ["goal", "inflow_goal"]) metricValue(body[k], { goal: true });
  if (body.channels.length > 40)
    throw Error("채널은 최대 40개까지 등록할 수 있습니다.");
  for (const c of body.channels) {
    if (!c.name.trim() || c.name.length > 80)
      throw Error("채널명은 1~80자로 입력하세요.");
    for (const k of ["visits", "conversions", "cost"]) metricValue(c[k]);
    if (c.visits !== null && c.conversions !== null && c.conversions > c.visits)
      throw Error("전환 수는 유입 수보다 클 수 없습니다.");
  }
  return body;
}
export function funnelTotals(channels) {
  const sum = (k) =>
    channels.length && channels.every((c) => c[k] != null)
      ? channels.reduce((n, c) => n + c[k], 0)
      : null;
  const visits = sum("visits"),
    conversions = sum("conversions"),
    cost = sum("cost");
  const paid = channels.filter((c) => c.type === "AD");
  return {
    visits,
    conversions,
    cost,
    rate:
      visits > 0 && conversions !== null ? (conversions / visits) * 100 : null,
    paidCost:
      paid.length &&
      paid.every((c) => c.cost !== null && c.conversions !== null) &&
      paid.reduce((s, c) => s + c.conversions, 0) > 0
        ? paid.reduce((s, c) => s + c.cost, 0) /
          paid.reduce((s, c) => s + c.conversions, 0)
        : null,
  };
}
