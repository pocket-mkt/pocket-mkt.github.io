import React from "react";
import KpiDailyView from "../src/KpiDailyView.jsx";
import {createHubDataSource} from '../src/api/dataSource.js';
import {
  defaultSettings,
  emptyDay,
  newChannel,
  channelDay,
  todayKst,
  defaultDay,
  shiftDay,
  dailyCsv,
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
  const source=createHubDataSource({
    config:{endpoint:'https://example.invalid/api',hasEndpoint:true,mode:'live',loginEnabled:true},
    supabaseLive:adapter,
    env:{VITE_POCKET_DATA_BACKEND:'supabase',VITE_SUPABASE_URL:'https://example.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'public-test-key'}
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
    await mount();
    check(
      document
        .querySelector(".kd-entry-heading")
        .textContent.includes(date.slice(5).replace("-", ".")),
      "yesterday default incorrect",
    );
    check(writes.length === 0, "mount wrote default records");
    await fill("전체 홈페이지 유입", "150");
    check(
      writes.at(-1).body.visits === 150 && writes.at(-1).body.conversions === 4,
      "overall write wrong",
    );
    check(
      document
        .querySelector(".kd-stage.traffic strong")
        .textContent.includes(beforeDate.startsWith(month) ? "250" : "150"),
      "monthly summary stale",
    );
    await fill("실행 내용", "<img src=x onerror=alert(1)> 브리핑");
    check(
      !document.querySelector(".kd-briefing img"),
      "briefing HTML executed",
    );
    // Consecutive edits while a request is in flight retain focus and persist the final draft.
    let release;
    hold = new Promise((r) => (release = r));
    await fill("전체 홈페이지 유입", "160");
    const second = await fill("전체 최종 전환", "7", false);
    check(!second.disabled, "save blocked next input");
    second.blur();
    await tick();
    release();
    hold = null;
    await tick();
    await tick();
    await tick();
    check(
      records.get("DAY:" + date).body.visits === 160 &&
        records.get("DAY:" + date).body.conversions === 7,
      "queued edit lost",
    );
    const pasteTarget = input("네이버 검색광고 집행비"),
      transfer = new DataTransfer();
    transfer.setData("text", "40000\t6000\t160");
    pasteTarget.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      }),
    );
    await tick();
    await tick();
    check(
      records.get("DAY:" + date).body.channels[0].clicks === 160,
      "multi-cell paste failed",
    );
    failWrite = true;
    await fill("전체 최종 전환", "8");
    check(document.querySelector(".kd-save.error"), "failed save hidden");
    const failed = writes.at(-1);
    check(
      !window.dispatchEvent(
        new Event("pocket:before-navigate", { cancelable: true }),
      ),
      "unsaved navigation not blocked",
    );
    failWrite = false;
    button("저장 재시도").click();
    await tick();
    await tick();
    check(
      writes.at(-1).mutationId === failed.mutationId,
      "retry mutation changed",
    );
    check(records.get("DAY:" + date).body.conversions === 8, "retry failed");
    const dt = new DataTransfer(),
      importBody = {
        ...records.get("DAY:" + date).body,
        visits: 222,
        conversions: 9,
      };
    dt.items.add(
      new File([dailyCsv(importBody)], "daily.csv", { type: "text/csv" }),
    );
    const file = input("일별 KPI CSV 업로드"),
      beforeWrites = writes.length;
    file.files = dt.files;
    file.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();
    await tick();
    check(
      document.querySelector(".kd-import-review") &&
        writes.length === beforeWrites,
      "upload skipped preview",
    );
    button("이 날짜에 적용").click();
    await tick();
    await tick();
    check(records.get("DAY:" + date).body.visits === 222, "CSV apply failed");
    document.querySelector(".kd-history summary").click();
    await tick();
    await tick(); // settings history
    const dayHistory = document.querySelector(".kd-entry .kd-history summary");
    dayHistory.click();
    await tick();
    await tick();
    check(
      document
        .querySelector(".kd-entry .kd-history")
        .textContent.includes("전체 유입"),
      "history missing changes",
    );
    conflict = true;
    await fill("전체 최종 전환", "10");
    check(
      input("전체 최종 전환").value === "10" &&
        document.querySelector(".kd-error"),
      "conflict draft lost",
    );
    conflict = false;
    window.confirm = () => true;
    button("최신 기록").click();
    await tick();
    await tick();
    await tick();
    check(input("전체 최종 전환").value === "9", "canonical reload failed");
    window.confirm = () => false;
    // Project remount and read-only boundaries.
    await mount({ project: { id: 2, name: "메디신피아" } });
    check(input("전체 홈페이지 유입").value === "", "cross-project draft leak");
    await mount({ canWrite: false });
    check(
      input("전체 홈페이지 유입").disabled &&
        !button("파일 업로드") &&
        !button("채널 추가"),
      "read-only actions exposed",
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
    check(input("전체 홈페이지 유입"), "read retry failed");
    await mount();
    check(
      document.documentElement.scrollWidth <= innerWidth + 2,
      "daily page horizontal overflow",
    );
    document.activeElement?.blur();
    window.scrollTo(0, 0);
    return {
      dailyEdits: true,
      autosaveQueue: true,
      atomicPaste: true,
      csvPreview: true,
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
