import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { acquireBodyScrollLock } from "../src/bodyScrollLock.js";

function withFakeBody(run, initialOverflow = "") {
  const previousDocument = globalThis.document;
  const style = {
    overflow: initialOverflow,
    removeProperty(name) {
      if (name === "overflow") this.overflow = "";
    },
  };
  globalThis.document = { body: { style } };
  try {
    run(style);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
}

test("겹친 모달이 역순으로 닫혀도 마지막 잠금 해제 시 본문 스크롤을 복원한다", () => {
  withFakeBody((style) => {
    const releaseTaskModal = acquireBodyScrollLock();
    const releaseSaveOverlay = acquireBodyScrollLock();
    assert.equal(style.overflow, "hidden");

    releaseTaskModal();
    assert.equal(style.overflow, "hidden");

    releaseSaveOverlay();
    assert.equal(style.overflow, "");
  });
});

test("중복 해제는 다른 스크롤 잠금을 풀지 않는다", () => {
  withFakeBody((style) => {
    const releaseFirst = acquireBodyScrollLock();
    const releaseSecond = acquireBodyScrollLock();

    releaseFirst();
    releaseFirst();
    assert.equal(style.overflow, "hidden");

    releaseSecond();
    assert.equal(style.overflow, "");
  });
});

test("기존 인라인 overflow 값은 마지막 잠금 해제 뒤 보존한다", () => {
  withFakeBody((style) => {
    const release = acquireBodyScrollLock();
    assert.equal(style.overflow, "hidden");
    release();
    assert.equal(style.overflow, "auto");
  }, "auto");
});

test("업무 모달과 저장 오버레이는 동일한 중첩 잠금 관리자를 사용한다", () => {
  const appSource = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const taskModalSource = readFileSync(new URL("../src/TaskCreateModal.jsx", import.meta.url), "utf8");

  assert.match(appSource, /const releaseScrollLock = acquireBodyScrollLock\(\)/);
  assert.match(taskModalSource, /const releaseScrollLock = acquireBodyScrollLock\(\)/);
  assert.doesNotMatch(appSource, /document\.body\.style\.overflow\s*=/);
  assert.doesNotMatch(taskModalSource, /document\.body\.style\.overflow\s*=/);
});
