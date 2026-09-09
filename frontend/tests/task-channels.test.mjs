import test from "node:test";
import assert from "node:assert/strict";
import { taskChannelOptions } from "../src/taskChannels.js";
import { taskCreateInitialFields, taskCreateSubmissionFields, taskCreateValidationError } from "../src/taskForm.js";
import { taskScheduleMedia } from "../src/taskTimeline.js";

test("creation channels include existing channels and project-specific media without duplicates", () => {
  const options = taskChannelOptions([{categoryCode:"INSTAGRAM"}, {categoryCode:"CUSTOM",category:"맞춤 채널"}, {categoryCode:"CUSTOM"}]);
  const codes = options.map(([code]) => code);
  for (const code of ["INSTAGRAM", "YOUTUBE", "NAVER_BLOG", "GOOGLE_SEARCH", "TIKTOK"]) assert.ok(codes.includes(code));
  assert.equal(codes.length, new Set(codes).size);
  assert.equal(new Map(options).get("CUSTOM"), "맞춤 채널");
});

test("regular and completed creation preserve selected category in the canonical payload", () => {
  for (const mode of ["default", "completed"]) {
    const initial = taskCreateInitialFields("ns", mode, "2026-09-09");
    assert.equal(initial.category_code, "");
    assert.equal(taskCreateValidationError(initial), "");
    assert.equal(Object.hasOwn(taskCreateSubmissionFields(initial), "category_code"), false);
    for (const [code] of taskChannelOptions().slice(1)) {
      const payload = taskCreateSubmissionFields({...initial, category_code:code});
      assert.equal(payload.category_code, code);
      assert.equal(Object.hasOwn(payload,"channel_code"), false);
      assert.notEqual(taskScheduleMedia({categoryCode:payload.category_code}), "미지정");
    }
  }
});
