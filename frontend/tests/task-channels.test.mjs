import test from "node:test";
import assert from "node:assert/strict";
import { taskChannelOptions, SHARED_TASK_CHANNELS } from "../src/taskChannels.js";
import { taskCreateInitialFields, taskCreateSubmissionFields, taskCreateValidationError, taskUpdateInitialFields, taskUpdateSubmissionFields } from "../src/taskForm.js";
import { taskScheduleMedia } from "../src/taskTimeline.js";

test('editing status does not fill gaps between explicitly selected dates', () => {
  const fields=taskUpdateInitialFields({title:'업무',plannedStartDate:'2026-09-11',dueDate:'2026-09-15',scheduleDates:['2026-09-11','2026-09-15']});
  assert.deepEqual(JSON.parse(taskUpdateSubmissionFields({...fields,status_code:'DONE'}).schedule_dates_json),['2026-09-11','2026-09-15']);
});

test("editing preserves, changes and clears the existing media through category_code", () => {
  const initial = taskUpdateInitialFields({categoryCode:"INSTAGRAM",title:"업무"});
  assert.equal(initial.category_code, "INSTAGRAM");
  assert.equal(taskUpdateSubmissionFields(initial).category_code, "INSTAGRAM");
  assert.equal(taskUpdateSubmissionFields({...initial,category_code:"NAVER_BLOG"}).category_code, "NAVER_BLOG");
  assert.equal(taskUpdateSubmissionFields({...initial,category_code:""}).category_code, "");
  assert.equal(Object.hasOwn(taskUpdateSubmissionFields({title:"업무"}), "category_code"), false);
});

test("creation channels include existing channels and project-specific media without duplicates", () => {
  const options = taskChannelOptions([{categoryCode:"INSTAGRAM"}, {categoryCode:"CUSTOM",category:"맞춤 채널"}, {categoryCode:"CUSTOM"}]);
  const codes = options.map(([code]) => code);
  assert.deepEqual(codes, ["", ...SHARED_TASK_CHANNELS, "CUSTOM"]);
  assert.equal(codes.length, new Set(codes).size);
  assert.equal(new Map(options).get("CUSTOM"), "맞춤 채널");
});

test("every project including NAVER-only and empty projects gets identical registered media", () => {
  const common = taskChannelOptions();
  assert.deepEqual(common.map(([code]) => code), ["", ...SHARED_TASK_CHANNELS]);
  for (const categoryCode of [...SHARED_TASK_CHANNELS, 'Instagram', 'YouTube', 'Ads', 'TikTok']) {
    assert.deepEqual(taskChannelOptions([{categoryCode}]), common);
  }
  assert.equal(new Map(common).get('NAVER'), '네이버');
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
