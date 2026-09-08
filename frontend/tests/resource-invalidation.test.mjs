import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { invalidateResourceReads, invalidateWorkspaceCaches } from "../src/resourceInvalidation.js";
import { readResourceSessionCache, removeResourceSessionCache, scheduleResourceSessionCacheWrite } from "../src/resourceSessionCache.js";

test("invalidating one resource retires only its pending requests and advances its generation", () => {
  const requests = new Map([["1:tasks:0:0", "old"], ["10:tasks:0:0", "other"], ["1:daily:0:0", "meeting"]]);
  const versions = new Map();
  invalidateResourceReads(requests, versions, "1:tasks");
  assert.equal(requests.has("1:tasks:0:0"), false);
  assert.equal(requests.get("10:tasks:0:0"), "other");
  assert.equal(requests.get("1:daily:0:0"), "meeting");
  assert.equal(versions.get("1:tasks"), 1);
  invalidateResourceReads(requests, versions, "1:tasks");
  assert.equal(versions.get("1:tasks"), 2);
});

test("workspace invalidation removes both summaries including queued sessionStorage writes", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  const session = { user: { userId: "test" } };
  let commit;
  const old = { cachedAt: Date.now(), state: { status: "ready", data: { items: ["stale"] } } };
  scheduleResourceSessionCacheWrite(session, "workspace:daily", old, { storage, schedule: (fn) => { commit = fn; return () => {}; } });
  const cache = new Map([["workspace:daily", old], ["workspace:portfolio", old], ["1:tasks", "canonical"]]);
  const requests = new Map([["workspace:daily:0:0", "old"], ["workspace:portfolio:0:0", "old"]]);
  const versions = new Map();
  invalidateWorkspaceCaches({ cache, requests, versions, removePersisted: (key) => removeResourceSessionCache(session, key, { storage }) });
  commit();
  assert.deepEqual([...cache.keys()], ["1:tasks"]);
  assert.equal(requests.size, 0);
  assert.equal(versions.get("workspace:daily"), 1);
  assert.equal(versions.get("workspace:portfolio"), 1);
  assert.equal(readResourceSessionCache(session, "workspace:daily", { storage }), null);
});

test("successful task and issue mutation paths invalidate derived dashboards", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const handlers = ["createRecord", "updateTask", "archiveTask", "updateTasksBatch", "createProjectIssue", "updateProjectIssue", "archiveProjectIssue"];
  for (const name of handlers) {
    const start = app.indexOf(`const ${name} = async`);
    assert.ok(start > 0, name);
    const end = app.indexOf("\n  const ", start + 1);
    assert.ok(app.slice(start, end).includes("invalidateWorkspaceSummaries()"), name);
  }
});
