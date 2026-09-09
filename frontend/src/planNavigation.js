export const PLAN_VARIANTS = Object.freeze({
  client: Object.freeze({ id: "client", label: "클라이언트 공유용", apiValue: "CLIENT_SHARE" }),
  internal: Object.freeze({ id: "internal", label: "실행계획", apiValue: "INTERNAL" }),
});

export const DEFAULT_PLAN_VARIANT = "client";

export function normalizePlanVariant(value) {
  return Object.prototype.hasOwnProperty.call(PLAN_VARIANTS, value) ? value : DEFAULT_PLAN_VARIANT;
}

export function parseViewLocation(hash = "") {
  const value = String(hash).replace(/^#/, "").trim().toLowerCase();
  if (value === "plan/internal") return { view: "plan", planVariant: "internal" };
  if (value === "plan/client" || value === "plan") return { view: "plan", planVariant: "client" };
  if (value === "tasks/schedule") return { view: "schedule", planVariant: DEFAULT_PLAN_VARIANT };
  if (value === "tasks/client-progress" || value === "client-progress") return { view: "client-progress", planVariant: DEFAULT_PLAN_VARIANT };
  if (value === "tasks/progress" || value === "progress") return { view: "progress", planVariant: DEFAULT_PLAN_VARIANT };
  if (["overview", "portfolio", "tasks", "schedule", "daily", "credentials", "content", "tracking", "performance", "files", "permissions"].includes(value)) {
    return { view: value, planVariant: DEFAULT_PLAN_VARIANT };
  }
  return { view: "portfolio", planVariant: DEFAULT_PLAN_VARIANT };
}

export function viewLocationHash(view, planVariant = DEFAULT_PLAN_VARIANT) {
  if (view === "schedule") return "tasks/schedule";
  if (view === "progress") return "tasks/progress";
  if (view === "client-progress") return "tasks/client-progress";
  return view === "plan" ? `plan/${normalizePlanVariant(planVariant)}` : view;
}

export function viewResourceKey(view, planVariant = DEFAULT_PLAN_VARIANT) {
  if (view === "schedule" || view === "progress") return "tasks";
  return view === "plan" ? `plan-${normalizePlanVariant(planVariant)}` : view;
}
