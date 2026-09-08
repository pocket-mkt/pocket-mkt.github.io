import test from "node:test";
import assert from "node:assert/strict";
import { createDiagnostics } from "../src/api/diagnostics.js";
test("diagnostics are bounded, summarize successes separately, and never retain secrets", async () => {
  let time=0;
  const d=createDiagnostics({limit:3,now:()=>time});
  const read=d.wrap("tasks", async () => {time+=20;return {body:"private content"};});
  await read({token:"secret"});await read();await read();await read();
  await assert.rejects(d.wrap("tasks",async()=>{throw Object.assign(Error("secret"),{code:"password-secret"});})());
  const result=d.summary();assert.equal(result[0].count,3);assert.equal(result[0].p95Ms,20);assert.equal(result[0].failures,1);
  assert.equal(JSON.stringify(result).includes("secret"),false);assert.equal(JSON.stringify(result).includes("private content"),false);
  d.clear();assert.deepEqual(d.summary(),[]);
});
test("login response is not serialized; logout discards late measurements",async()=>{
  const d=createDiagnostics();let release;
  const secret={toJSON(){throw Error("must not inspect auth response");}};
  assert.equal(await d.wrap("login",async()=>secret)(),secret);
  assert.equal(d.summary()[0].maxEstimatedBytes,0);
  const pending=d.wrap("tasks",()=>new Promise(resolve=>{release=resolve;}))();d.clear();release({});await pending;assert.deepEqual(d.summary(),[]);
});
