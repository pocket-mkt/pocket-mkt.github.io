import React from "react";
import KpiDailyView from "../src/KpiDailyView.jsx";
import { defaultSettings, todayKst, defaultDay } from "../src/kpiDailyModel.js";
import { createHubDataSource } from "../src/api/dataSource.js";
export async function runKpiStageQa(render, tick, check) {
  const month = todayKst().slice(0, 7),
    date = month + "-01",
    end = defaultDay(month),
    records = {},
    writes = [],
    seen = new Set();
  let fail = false,
    conflict = false,
    hold = null;
  const adapter = {
    kpiDaily: async ({ projectId }) => ({
      data:
        projectId === 2
          ? {
              days: [],
              settings: null,
              stage_sheets: {},
              goals: null,
              canWrite: true,
            }
          : {
              days: [],
              settings: {
                body: {
                  ...defaultSettings(),
                  inflow_source: "GA4",
                  conversion_source: "예약 관리자",
                  rate_enabled: true,
                  definition: "한국시간 전체 기간",
                },
                row_version: 1,
              },
              stage_sheets: Object.fromEntries(
                Object.entries(records).filter(([k]) => k.startsWith("STAGE_")),
              ),
              goals: records.GOALS || null,
              canWrite: true,
            },
    }),
    saveKpiDaily: async (p) => {
      writes.push(structuredClone(p));
      if (hold) await hold;
      if (fail) throw Error("연결 오류");
      if (conflict)
        throw Object.assign(Error("다른 사용자가 수정했습니다"), {
          code: "conflict",
        });
      if (seen.has(p.mutationId))
        return { data: { item: records[p.kind], replayed: true } };
      check(
        (records[p.kind]?.row_version ?? null) === p.rowVersion,
        "stage stale version",
      );
      records[p.kind] = {
        date: p.date,
        body: structuredClone(p.body),
        row_version: (p.rowVersion || 0) + 1,
        updated_at: new Date().toISOString(),
        updated_by: "NS",
      };
      seen.add(p.mutationId);
      return { data: { item: records[p.kind] } };
    },
    kpiDailyHistory: async () => ({ data: { items: [], next_cursor: null } }),
  };
  const source = createHubDataSource({
    config: {
      endpoint: "https://example.invalid/api",
      hasEndpoint: true,
      mode: "live",
      loginEnabled: true,
    },
    supabaseLive: adapter,
    env: {
      VITE_POCKET_DATA_BACKEND: "supabase",
      VITE_SUPABASE_URL: "https://example.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "public-test-key",
    },
  });
  const mount = async (props = {}) => {
    await render(<div />);
    await render(
      <div style={{ padding: 16 }}>
        <KpiDailyView
          project={{ id: 1, name: "UND" }}
          source={source}
          canWrite
          {...props}
        />
      </div>,
    );
    await tick();
    await tick();
  };
  const el = (label) => document.querySelector(`[aria-label="${label}"]`);
  const btn = (text) =>
    [...document.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === text,
    );
  const fill = async (label, value) => {
    const input = el(label);
    check(input && !input.disabled, "missing stage field " + label);
    input.focus();
    const proto =
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : input instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
    input.dispatchEvent(
      new Event(input instanceof HTMLSelectElement ? "change" : "input", {
        bubbles: true,
      }),
    );
    await tick();
  };
  const click = async (target) => {
    check(target, "missing stage action");
    target.click();
    await tick();
    await tick();
  };
  const open = async (n) =>
    click(document.querySelectorAll(".kd-stage")[n - 1]);
  const close = async () => click(el("시트 닫기"));
  const confirmBefore = window.confirm;
  window.confirm = () => false;
  try {
    await mount();
    check(writes.length === 0, "stage mount saved defaults");
    await open(2);
    check(document.querySelector('[role="dialog"]'), "stage card did not open");
    await click(btn("기간 지정"));
    await fill("실적 시작일", date);
    await fill("실적 종료일", end);
    await fill("실적 유입", "300");
    await fill("실적 메모", "주간 누적 실적");
    check(writes.length === 0, "stage input wrote before explicit append");
    check(
      !window.dispatchEvent(
        new Event("pocket:before-navigate", { cancelable: true }),
      ),
      "stage dirty navigation escaped",
    );
    await close();
    check(document.querySelector('[role="dialog"]'), "dirty close lost draft");
    let release;
    hold = new Promise((r) => (release = r));
    const submitButton = btn("기록 추가");
    submitButton.click();
    await tick();
    submitButton.click();
    check(writes.length === 1, "double submit duplicated");
    release();
    hold = null;
    await tick();
    await tick();
    check(records.STAGE_2.body.entries.length === 1, "range append failed");
    check(
      document.querySelector(".ks-records").textContent.includes("300"),
      "record not immediately visible",
    );
    await fill("실적 시작일", date);
    await fill("실적 유입", "100");
    await click(btn("기록 추가"));
    check(
      document.querySelector("[role=alert]").textContent.includes("겹"),
      "overlap not shown",
    );
    check(writes.length === 1, "overlap wrote");
    window.confirm = () => true;
    await click(document.querySelector(".ks-row-actions button"));
    await fill("실적 유입", "320");
    await click(btn("수정 저장"));
    check(records.STAGE_2.body.entries[0].value === 320, "entry edit failed");
    await close();
    check(
      document
        .querySelector(".kd-stage.traffic strong")
        .textContent.includes("320"),
      "stage total not updated",
    );
    await open(1);
    await click(btn("기간 지정"));
    await fill("실적 시작일", date);
    await fill("실적 종료일", end);
    await fill("실적 채널", "네이버 검색광고");
    await fill("실적 노출·조회", "10000");
    await fill("실적 클릭", "350");
    await click(btn("기록 추가"));
    await close();
    const metricValue = (key) =>
      document.querySelector(`.kd-marketing-metrics [data-metric="${key}"] dd`)
        ?.textContent;
    check(
      metricValue("impressions").includes("10,000") &&
        metricValue("clicks").includes("350") &&
        metricValue("ctr").includes("3.5") &&
        metricValue("cost").includes("—"),
      "non-cost marketing results hidden",
    );
    await open(1);
    await click(document.querySelector(".ks-row-actions button"));
    await fill("실적 집행비", "30000");
    await click(btn("수정 저장"));
    await close();
    check(
      metricValue("cost").includes("30,000") &&
        metricValue("ctr").includes("3.5"),
      "cost hides marketing results",
    );
    await open(3);
    await click(btn("기간 지정"));
    await fill("실적 시작일", date);
    await fill("실적 종료일", end);
    await fill("실적 전환", "16");
    fail = true;
    await click(btn("기록 추가"));
    const failed = writes.at(-1);
    check(el("실적 전환").value === "16", "failed draft lost");
    check(btn("저장 재시도"), "retry absent");
    fail = false;
    await click(btn("저장 재시도"));
    check(
      writes.at(-1).mutationId === failed.mutationId,
      "stage retry id changed",
    );
    check(records.STAGE_3.body.entries.length === 1, "stage retry duplicate");
    await close();
    check(
      document
        .querySelector(".kd-stage.conversion footer")
        .textContent.includes("5%"),
      "ratio not recalculated",
    );
    await click(
      [...document.querySelectorAll("button")].find((b) =>
        b.textContent.includes("목표 설정"),
      ),
    );
    for (let i = 1; i <= 5; i++) {
      await click(document.querySelector(".ks-add-goal"));
      await fill(
        `목표 ${i} 이름`,
        [
          "노출 확대",
          "월 유입 목표",
          "예약 확보",
          "광고비 한도",
          "콘텐츠 발행",
        ][i - 1],
      );
      await fill(
        `목표 ${i} 지표`,
        ["impressions", "visits", "conversions", "cost", "posts"][i - 1],
      );
      await fill(`목표 ${i} 값`, ["10000", "500", "30", "50000", "10"][i - 1]);
      if (i === 4) await fill(`목표 ${i} 조건`, "AT_MOST");
    }
    check(
      document.querySelector(".ks-add-goal").disabled,
      "sixth goal allowed",
    );
    await click(btn("목표 저장"));
    check(records.GOALS.body.goals.length === 5, "goals not persisted");
    await close();
    check(
      document.querySelectorAll(".ks-goal-preview").length === 5,
      "goals not projected onto stages",
    );
    await mount();
    check(
      document
        .querySelector(".kd-stage.traffic strong")
        .textContent.includes("320"),
      "reload lost stage",
    );
    await open(3);
    await click(document.querySelector(".ks-row-actions button"));
    await fill("실적 전환", "20");
    conflict = true;
    await click(btn("수정 저장"));
    check(
      el("실적 전환").value === "20" && document.querySelector("[role=alert]"),
      "conflict lost draft",
    );
    conflict = false;
    await close();
    await mount({ canWrite: false });
    await open(2);
    check(
      !btn("기록 추가") && !document.querySelector(".ks-row-actions"),
      "read-only stage writable",
    );
    await close();
    await mount({ project: { id: 2, name: "무극" } });
    check(
      document
        .querySelector(".kd-stage.traffic strong")
        .textContent.includes("—"),
      "cross-project stage leak",
    );
    await mount();
    await open(1);
    check(
      document.documentElement.scrollWidth <= innerWidth + 2,
      "stage global overflow",
    );
    const box = document.querySelector(".ks-dialog").getBoundingClientRect();
    check(
      box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
      "dialog outside viewport",
    );
    const footer = document.querySelector(".ks-footer").getBoundingClientRect();
    check(footer.bottom <= innerHeight, "save footer clipped");
    window.stageQaOpenGoals = async () => {
      await close();
      await click(
        [...document.querySelectorAll("button")].find((b) =>
          b.textContent.includes("목표 설정"),
        ),
      );
    };
    window.stageQaShowDashboard = async () => {
      await close();
      window.scrollTo(0, 0);
      check(document.querySelector('.kd-marketing-metrics').getBoundingClientRect().width >= document.querySelector('.kd-stage.marketing').getBoundingClientRect().width - 40, 'marketing metrics squeezed beside goals');
      const metrics = [
        ...document.querySelectorAll(".kd-marketing-metrics dd"),
      ];
      check(
        metrics.length === 4 &&
          metrics.every((el) => el.scrollWidth <= el.clientWidth + 1),
        "marketing metric value clipped",
      );
      check(
        document.documentElement.scrollWidth <= innerWidth + 2,
        "marketing summary overflow",
      );
    };
    return {
      clickableStages: true,
      marketingMetricsWithoutSpend: true,
      dateRange: true,
      appendEdit: true,
      overlapBlocked: true,
      immutableRetry: true,
      fiveGoals: true,
      ratio: true,
      readOnly: true,
      projectIsolation: true,
      dialogFit: true,
    };
  } finally {
    window.confirm = confirmBefore;
  }
}
