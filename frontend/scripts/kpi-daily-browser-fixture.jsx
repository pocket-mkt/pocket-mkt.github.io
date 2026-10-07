import React from "react";
import * as echarts from "echarts";
import KpiDailyView from "../src/KpiDailyView.jsx";
import { createHubDataSource } from "../src/api/dataSource.js";
import {
  defaultSettings,
  emptyDay,
  newChannel,
  todayKst,
  defaultDay,
  shiftDay,
} from "../src/kpiDailyModel.js";

export async function runKpiDailyQa(render, tick, check) {
  const today = todayKst(),
    month = today.slice(0, 7),
    date = defaultDay(month, today),
    records = new Map(),
    writes = [],
    audits = [],
    seen = new Map();
  let failRead = false,
    failWrite = false,
    conflict = false,
    hold = null;
  const settings = {
    ...defaultSettings(),
    inflow_goal: 3000,
    conversion_goal: 90,
    inflow_source: "GA4 세션",
    conversion_source: "예약 장부",
    definition: "한국시간 기준 일별 실적, 취소·중복 제외",
    rate_enabled: true,
    channels: [
      newChannel("네이버 검색광고", "AD", "naver"),
      newChannel("인스타그램", "CONTENT", "insta"),
    ],
  };
  const body = {
    ...emptyDay(settings),
    visits: 120,
    conversions: 4,
    execution: "검색광고 소재 교체, 인스타그램 게시 1건",
    insight: "클릭은 늘었지만 예약 전환은 추가 확인이 필요합니다.",
    next_action: "NS: 랜딩 첫 화면 문구 테스트",
    pocket_request: "포켓: 신규 소재 컨펌 요청",
  };
  body.channels[0] = {
    ...body.channels[0],
    cost: 35000,
    impressions: 5600,
    clicks: 140,
    visits: 80,
    conversions: 2,
    link: "https://example.com/report",
  };
  body.channels[1] = {
    ...body.channels[1],
    cost: 0,
    posts: 1,
    impressions: 2100,
    visits: 40,
    conversions: 2,
  };
  const item = (body, version = 1, dateValue = date) => ({
    date: dateValue,
    body: structuredClone(body),
    row_version: version,
    updated_at: new Date().toISOString(),
    updated_by: "NS 마케팅",
  });
  records.set("SETTINGS:" + month + "-01", item(settings, 1, month + "-01"));
  records.set("DAY:" + date, item(body));
  const beforeDate = shiftDay(date, -1);
  if (beforeDate.startsWith(month))
    records.set(
      "DAY:" + beforeDate,
      item({ ...body, visits: 100, conversions: 3 }, 1, beforeDate),
    );
  const adapter = {
    kpiDaily: async ({ month: m, projectId }) => {
      if (failRead) throw Error("조회 실패 테스트");
      if (projectId === 2)
        return { data: { settings: null, days: [], canWrite: true } };
      return {
        data: {
          settings: records.get("SETTINGS:" + m + "-01") || null,
          days: [...records.entries()]
            .filter(([k, v]) => k.startsWith("DAY:") && v.date.startsWith(m))
            .map(([, v]) => structuredClone(v)),
          legacy_exists: true,
          canWrite: true,
        },
      };
    },
    saveKpiDaily: async (p) => {
      writes.push(structuredClone(p));
      if (conflict)
        throw Object.assign(Error("다른 사용자가 수정했습니다"), {
          code: "conflict",
        });
      if (hold) await hold;
      if (failWrite) throw Error("연결 오류 테스트");
      const key = p.kind + ":" + p.date,
        old = records.get(key);
      if (seen.has(p.mutationId))
        return { data: { item: structuredClone(old), replayed: true } };
      check(
        (old?.row_version ?? null) === p.rowVersion,
        "daily stale version submitted",
      );
      const next = item(p.body, (old?.row_version || 0) + 1, p.date);
      records.set(key, next);
      seen.set(p.mutationId, true);
      audits.unshift({
        id: audits.length + 1,
        actor: "NS 마케팅",
        occurred_at: new Date().toISOString(),
        before_body: old?.body,
        after_body: p.body,
        row_version: next.row_version,
      });
      return { data: { item: structuredClone(next) } };
    },
    kpiDailyHistory: async () => ({
      data: { items: audits.slice(0, 10), next_cursor: null },
    }),
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
          project={{ id: 1, name: "UND", clientName: "UND" }}
          source={source}
          canWrite
          {...props}
        />
      </div>,
    );
    await tick();
    await tick();
  };
  const input = (label) =>
    document.querySelector('[aria-label="' + label + '"]');
  const fill = async (label, value, blur = true) => {
    const el = input(label);
    check(el && !el.disabled, "missing/edit-disabled " + label);
    el.focus();
    Object.getOwnPropertyDescriptor(
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      "value",
    ).set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    check(document.activeElement === el, "focus lost " + label);
    if (blur) {
      el.blur();
      await tick();
      await tick();
    }
    return el;
  };
  const button = (text) =>
    [...document.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === text,
    );
  const priorConfirm = window.confirm;
  window.confirm = () => false;
  try {
    const legacyBefore = JSON.stringify(
      [...records].filter(([k]) => k.startsWith("DAY:")),
    );
    await mount();
    check(
      !document.querySelector(
        ".kd-settings, .kd-dates, .kd-entry, .kd-ledger, .kd-trend",
      ),
      "removed sections still mounted",
    );
    for (const text of [
      "측정 기준·운영 채널",
      "날짜별 입력·브리핑",
      "NS 데일리 브리핑",
      "CSV 양식",
      "파일 업로드",
    ])
      check(
        !document.body.textContent.includes(text),
        "removed UI still visible: " + text,
      );
    check(writes.length === 0, "mount wrote default records");
    input("KPI 데이터 입력").click();
    await tick();
    await tick();
    check(
      document
        .querySelector(".ks-legacy-note")
        ?.textContent.includes("누적과 추이"),
      "legacy preservation note missing",
    );
    check(
      !document.body.textContent.includes("날짜별 입력·브리핑"),
      "dialog points to removed UI",
    );
    document.querySelector('.ks-dialog button[aria-label="시트 닫기"]').click();
    await tick();
    check(
      document.querySelectorAll(".kd-stage").length === 3,
      "funnel cards removed",
    );
    check(
      document
        .querySelector(".kd-stage.traffic strong")
        .textContent.includes(beforeDate.startsWith(month) ? "220" : "120"),
      "legacy daily totals missing",
    );
    input("2단계 유입 일별 추이 보기").click();
    for (
      let i = 0;
      i < 10 && !document.querySelector(".kt-dialog .kd-chart");
      i++
    )
      await tick();
    await tick();
    const chart = echarts.getInstanceByDom(
      document.querySelector(".kt-dialog .kd-chart"),
    );
    check(
      chart.getOption().series[0].data.some((p) => p.value === 120),
      "legacy daily trend missing",
    );
    document.querySelector(".kt-dialog button[aria-label]").click();
    await tick();
    const label = "2단계 유입 항목 이름";
    await fill(label, "플레이스 유입");
    check(
      records.get("SETTINGS:" + month + "-01").body.inflow_label ===
        "플레이스 유입",
      "label write failed",
    );
    check(
      records.get("SETTINGS:" + month + "-01").body.channels.length === 2,
      "hidden roster removed by label write",
    );
    // The remaining inline name editor retains serialized writes and navigation protection.
    let release;
    hold = new Promise((r) => (release = r));
    await fill(label, "전화 유입");
    await fill(label, "방문 유입");
    check(
      !window.dispatchEvent(
        new Event("pocket:before-navigate", { cancelable: true }),
      ),
      "in-flight navigation allowed",
    );
    release();
    hold = null;
    await tick();
    await tick();
    await tick();
    check(
      records.get("SETTINGS:" + month + "-01").body.inflow_label ===
        "방문 유입",
      "queued label edit lost",
    );
    failWrite = true;
    await fill(label, "예약 유입");
    check(document.querySelector(".kd-save.error"), "failed save hidden");
    const failed = writes.at(-1);
    check(
      !window.dispatchEvent(
        new Event("pocket:before-navigate", { cancelable: true }),
      ),
      "dirty navigation allowed",
    );
    failWrite = false;
    button("저장 재시도").click();
    await tick();
    await tick();
    check(
      writes.at(-1).mutationId === failed.mutationId,
      "label retry mutation changed",
    );
    conflict = true;
    await fill(label, "충돌한 유입명");
    check(
      input(label).value === "충돌한 유입명" &&
        document.querySelector("[role=alert]"),
      "conflict draft lost",
    );
    conflict = false;
    window.confirm = () => true;
    button("충돌·권한 다시 확인").click();
    await tick();
    await tick();
    await tick();
    check(input(label).value === "예약 유입", "canonical reload failed");
    window.confirm = () => false;
    check(
      JSON.stringify([...records].filter(([k]) => k.startsWith("DAY:"))) ===
        legacyBefore,
      "legacy data changed on UI removal",
    );
    check(
      writes.every((w) => w.kind === "SETTINGS"),
      "removed editor caused writes",
    );
    await mount({ project: { id: 2, name: "메디신피아" } });
    check(input(label).value === "유입", "cross-project draft leak");
    check(
      document
        .querySelector(".kd-stage.traffic strong")
        .textContent.includes("—"),
      "cross-project values leak",
    );
    await mount({ canWrite: false });
    check(
      input(label).disabled &&
        !input("KPI 데이터 입력") &&
        input("KPI 입력 기록"),
      "readonly actions wrong",
    );
    failRead = true;
    await mount();
    check(
      document.querySelector("[role=alert]")?.textContent.includes("조회 실패"),
      "fetch failure blank",
    );
    failRead = false;
    button("다시 시도").click();
    await tick();
    await tick();
    check(input(label), "read retry failed");
    await mount();
    check(
      document.documentElement.scrollWidth <= innerWidth + 2,
      "KPI page horizontal overflow",
    );
    document.activeElement?.blur();
    window.scrollTo(0, 0);
    return {
      minimalDashboard: true,
      legacyDailyPreserved: true,
      legacyTrend: true,
      inlineLabelSave: true,
      autosaveQueue: true,
      immutableRetry: true,
      conflictDraft: true,
      readOnly: true,
      projectIsolation: true,
      noGlobalOverflow: true,
    };
  } finally {
    window.confirm = priorConfirm;
  }
}
