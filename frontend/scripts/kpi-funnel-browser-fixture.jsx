import React from "react";
import KpiFunnelView from "../src/KpiFunnelView.jsx";
import { emptyFunnel, monthNow } from "../src/kpiFunnelModel.js";
export async function runKpiFunnelQa(render, tick, check) {
  const records = new Map(),
    writes = [];
  let client = false,
    fail = false;
  const body = {
    ...emptyFunnel(),
    goal: 100,
    inflow_goal: 3000,
    channels: [
      {
        id: "a",
        name: "네이버 검색광고",
        type: "AD",
        visits: 1000,
        conversions: 20,
        cost: 300000,
      },
      {
        id: "b",
        name: "인스타그램 콘텐츠",
        type: "CONTENT",
        visits: 500,
        conversions: 10,
        cost: 0,
      },
    ],
  };
  records.set(monthNow(), {
    body,
    row_version: 1,
    updated_at: new Date().toISOString(),
  });
  const result = (month) => {
    let item = structuredClone(records.get(month) || null);
    if (client && item) {
      if (!item.body.customer_visible) item = null;
      else item.body.channels.forEach((c) => delete c.cost);
    }
    return { ok: true, data: { item, internal: !client, canWrite: !client } };
  };
  const source = {
    kpiFunnel: async ({ month }) => result(month),
    saveKpiFunnel: async (p) => {
      writes.push(p);
      if (fail) throw Error("충돌 테스트");
      check(
        p.rowVersion === (records.get(p.month)?.row_version ?? null),
        "wrong version",
      );
      records.set(p.month, {
        body: p.body,
        row_version: (p.rowVersion || 0) + 1,
        updated_at: new Date().toISOString(),
      });
      return result(p.month);
    },
  };
  const mount = async () => {
    await render(<div />);
    await render(
      <KpiFunnelView
        project={{ id: 1, name: "UND" }}
        source={source}
        canWrite={!client}
      />,
    );
    await tick();
  };
  const input = (label) =>
    document.querySelector('input[aria-label="' + label + '"]');
  const fill = async (label, value) => {
    const el = input(label);
    el.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    check(document.activeElement === el, "input lost focus: " + label);
    return el;
  };
  await mount();
  check(input("전환 목표").value === "100", "goal missing");
  let el = await fill("전환 목표", "150");
  el.blur();
  await tick();
  await tick();
  check(records.get(monthNow()).body.goal === 150, "goal autosave failed");
  el = await fill("네이버 검색광고 유입", "1200");
  el.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );
  await tick();
  await tick();
  check(
    records.get(monthNow()).body.channels[0].visits === 1200,
    "Enter save failed",
  );
  const n = writes.length;
  el = await fill("전환 목표", "999");
  el.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  await tick();
  check(
    writes.length === n && input("전환 목표").value === "150",
    "Escape failed",
  );
  fail = true;
  el = await fill("전환 목표", "200");
  el.blur();
  await tick();
  await tick();
  check(
    input("전환 목표").value === "200" &&
      document.body.textContent.includes("충돌 테스트"),
    "failure lost draft",
  );
  fail = false;
  await mount();
  document.querySelector('[aria-label="이전 달"]').click();
  await tick();
  await tick();
  check(input("전환 목표").value === "", "previous month copied actuals");
  document.querySelector('[aria-label="다음 달"]').click();
  await tick();
  await tick();
  check(input("전환 목표").value === "150", "month not retained");
  [...document.querySelectorAll("button")]
    .find((b) => b.textContent === "채널 추가")
    .click();
  await tick();
  await fill("새 채널 이름", "구글 검색");
  document
    .querySelector(".kf-add")
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await tick();
  await tick();
  check(records.get(monthNow()).body.channels.length === 3, "add failed");
  const confirm = window.confirm;
  window.confirm = () => true;
  document.querySelector('[aria-label="구글 검색 삭제"]').click();
  await tick();
  await tick();
  window.confirm = confirm;
  check(records.get(monthNow()).body.channels.length === 2, "delete failed");
  client = true;
  await mount();
  check(
    document.body.textContent.includes("공개된 KPI 실적이 없습니다"),
    "unpublished visible",
  );
  records.get(monthNow()).body.customer_visible = true;
  await mount();
  check(
    !input("전환 목표") && !document.body.textContent.includes("광고비"),
    "customer editing/cost visible",
  );
  client = false;
  await mount();
  for (let i = 0; i < 30 && !document.querySelector(".kf-chart canvas"); i++)
    await tick();
  check(document.querySelector(".kf-chart canvas"), "chart missing");
  check(
    document.documentElement.scrollWidth <= window.innerWidth + 2,
    "page overflow",
  );
  return {
    inlineSave: true,
    enterEscape: true,
    failedDraft: true,
    monthHistory: true,
    channelAddDelete: true,
    customerReadOnly: true,
    chart: true,
  };
}
