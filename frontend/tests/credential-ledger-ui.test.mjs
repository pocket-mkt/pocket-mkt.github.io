import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appPath = new URL("../src/App.jsx", import.meta.url);
const componentPath = new URL("../src/CredentialLedgerView.jsx", import.meta.url);
const dataSourcePath = new URL("../src/api/dataSource.js", import.meta.url);
const accessPath = new URL("../src/accessPermissions.js", import.meta.url);

test("아이디 관리대장은 프로젝트 메뉴에 있으나 고객 권한 선택지에서는 제외된다", async () => {
  const [app, access] = await Promise.all([readFile(appPath, "utf8"), readFile(accessPath, "utf8")]);
  assert.match(access, /id: "credentials"[\s\S]*customerSelectable: false/);
  assert.match(access, /pageIds:[\s\S]*"credentials"/);
  assert.match(access, /normalized === "credentials"\) return false/);
  assert.match(app, /view === "credentials"[\s\S]*role !== "client"/);
});

test("비밀번호는 기본 마스킹되고 건별 열람·복사만 제공한다", async () => {
  const [component, dataSource, app] = await Promise.all([
    readFile(componentPath, "utf8"),
    readFile(dataSourcePath, "utf8"),
    readFile(appPath, "utf8"),
  ]);
  assert.match(component, /••••••••••••/);
  assert.match(component, /onReveal\(credential\)/);
  assert.match(component, /비밀번호 복사/);
  assert.match(component, /autoComplete="new-password"/);
  assert.match(dataSource, /revealCredential: \(params\) => domainWrite\("revealCredential", params\)/);
  assert.doesNotMatch(app.match(/const PERSISTED_RESOURCES[^;]+;/)?.[0] || "", /credentials/);
});

test("대장은 등록·수정·삭제와 프로젝트 전환 시 노출값 제거를 제공한다", async () => {
  const component = await readFile(componentPath, "utf8");
  assert.match(component, /계정 등록/);
  assert.match(component, /계정 정보 수정/);
  assert.match(component, /onArchive\(credential\)/);
  assert.match(component, /setRevealed\(\{\}\)[\s\S]*\[project\.id\]/);
});
