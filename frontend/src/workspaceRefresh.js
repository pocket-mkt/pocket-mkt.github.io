// Visibility/focus + a bounded visible-tab poll. Do not refresh active drafts,
// drags or writes. No hidden-tab polling, overlapping requests or retry storm.
export function startWorkspaceRefresh({ refresh, busy = () => false, document: doc = globalThis.document, window: win = globalThis.window, intervalMs = 60_000, now = Date.now }) {
  let stopped = false, pending = false, lastStarted = now(), failures = 0;
  async function check() {
    if (stopped || pending || doc.visibilityState !== "visible" || win.navigator?.onLine === false || busy()) return;
    if (now() - lastStarted < Math.min(300_000, 30_000 * 2 ** failures)) return;
    pending = true; lastStarted = now();
    try { await refresh(); failures = 0; } catch { failures = Math.min(4, failures + 1); }
    finally { pending = false; }
  }
  win.addEventListener("focus", check);
  win.addEventListener("online", check);
  doc.addEventListener("visibilitychange", check);
  const timer = win.setInterval(check, intervalMs);
  return () => { stopped = true; win.clearInterval(timer); win.removeEventListener("focus", check); win.removeEventListener("online", check); doc.removeEventListener("visibilitychange", check); };
}

// Only authority inputs, not project metadata or generatedAt. Stable ordering
// avoids treating a reordered bootstrap payload as a permission change.
export function authorizationFingerprint(data) {
  return JSON.stringify({ actor: data?.actor, projects: Object.entries(data?.projects || {}).map(([id, project]) => [id, project.permissionCode, [...(project.allowedPages || [])].sort()]).sort(([a], [b]) => a.localeCompare(b)) });
}
