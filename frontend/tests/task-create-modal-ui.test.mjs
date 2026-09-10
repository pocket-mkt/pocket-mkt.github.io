import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const modalSource = readFileSync(new URL("../src/TaskCreateModal.jsx", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../src/taskCreateModal.css", import.meta.url), "utf8");

test("업무 생성 필수 항목은 안내와 별도 시각 상태를 제공한다", () => {
  assert.match(modalSource, /className="task-create-required-note"/);
  assert.match(modalSource, /<Choices required label="업무 분야"/);
  assert.match(modalSource, /<Choices required label="담당"/);
  assert.match(modalSource, /<Choices required label="현재 상태"/);
  assert.doesNotMatch(modalSource, /name="progress_percent"/);
  assert.match(modalSource, /DELAYED/);
  assert.match(styleSource, /\.task-create-choices\.is-required/);
  assert.match(styleSource, /\.task-create-required-badge/);
});
