import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
const styleSource = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

test("원장 쓰기는 공통 저장 잠금과 중앙 모달을 사용한다", () => {
  assert.match(appSource, /function GlobalSaveOverlay/);
  assert.match(appSource, /role="dialog" aria-modal="true"/);
  assert.match(appSource, /데이터 저장 중/);
  assert.match(appSource, /sheetSaveLock\.visible && <GlobalSaveOverlay/);
  assert.match(appSource, /SAVE_OVERLAY_MIN_MS = 500/);
  assert.match(appSource, /SAVE_OVERLAY_COALESCE_MS = 250/);
  assert.match(appSource, /sheetSaveReleaseTimerRef/);
  assert.match(appSource, /sheetWriteCountRef\.current === 0/);
  assert.match(appSource, /window\.clearTimeout\(sheetSaveReleaseTimerRef\.current\)/);
  assert.match(styleSource, /\.global-save-overlay[\s\S]*position:\s*fixed[\s\S]*inset:\s*0[\s\S]*z-index:\s*200/);
  assert.match(styleSource, /\.app-shell\.is-sheet-saving > :not\(\.global-save-overlay\)[\s\S]*pointer-events:\s*none/);
});

test("업무·이슈·프로젝트·회의록·계정대장·KPI·권한 저장이 공통 잠금을 우회하지 않는다", () => {
  assert.equal((appSource.match(/await mutateWithSaveLock\(/g) || []).length, 12);
  assert.equal((appSource.match(/await mutateBatchWithSaveLock\(/g) || []).length, 1);
  assert.equal((appSource.match(/await accessMutateWithSaveLock\(/g) || []).length, 1);
  assert.doesNotMatch(appSource, /await source\.mutate\(/);
  assert.doesNotMatch(appSource, /await source\.mutateBatch\(/);
  assert.doesNotMatch(appSource, /await source\.accessAdminMutate\(/);
  assert.match(appSource, /runSheetWrite\(payload\.tasks\?\.length[\s\S]*source\.createProject\(payload\)/);
  assert.match(appSource, /runSheetWrite\(`견적 업무 \$\{payload\.tasks\.length\}개를 한 번에 저장하고 있습니다\.`/);
});
