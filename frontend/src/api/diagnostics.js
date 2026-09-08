// Bounded, tab-local diagnostics. Never retain arguments, identities, URLs,
// response bodies, error messages, credentials, or tokens.
const SAFE_CODES = new Set(["unauthorized", "forbidden", "conflict", "timeout", "aborted", "network_error", "rate_limited", "legacy_session_required", "unsupported_action"]);
const READS_WITH_SIZE = new Set(["bootstrap", "operationsDashboard", "tasks", "clientProgress", "plan", "dailyMeetings", "performance", "activity"]);
export function createDiagnostics({ limit = 300, now = () => performance.now() } = {}) {
  const samples = [];
  let generation = 0;
  function record(sample) {
    samples.push(Object.freeze(sample));
    if (samples.length > limit) samples.splice(0, samples.length - limit);
  }
  function wrap(name, operation) {
    return async (...args) => {
      const started = now(), epoch = generation;
      try {
        const result = await operation(...args);
        const durationMs = Math.max(0, now() - started);
        let estimatedBytes = null;
        // This is the decoded envelope size, NOT compressed network transfer.
        if (READS_WITH_SIZE.has(name)) {
          try { estimatedBytes = new TextEncoder().encode(JSON.stringify(result)).byteLength; } catch { /* measurement cannot fail a read */ }
        }
        if (generation === epoch) record({ name, durationMs, estimatedBytes, code: "ok" });
        return result;
      } catch (error) {
        if (generation === epoch) record({ name, durationMs: Math.max(0, now() - started), estimatedBytes: null, code: SAFE_CODES.has(error?.code) ? error.code : "other_error" });
        throw error;
      }
    };
  }
  function summary() {
    return [...new Set(samples.map(sample => sample.name))].map(name => {
      const rows = samples.filter(sample => sample.name === name);
      const successful = rows.filter(sample => sample.code === "ok");
      const times = successful.map(sample => sample.durationMs).sort((a, b) => a - b);
      const percentile = p => times.length ? Math.round(times[Math.max(0, Math.ceil(times.length * p) - 1)] * 10) / 10 : null;
      return { name, count: rows.length, successes: successful.length, failures: rows.length - successful.length, p50Ms: percentile(.5), p95Ms: percentile(.95), maxEstimatedBytes: Math.max(0, ...successful.map(sample => sample.estimatedBytes || 0)), errors: Object.fromEntries([...new Set(rows.filter(sample => sample.code !== "ok").map(sample => sample.code))].map(code => [code, rows.filter(sample => sample.code === code).length])) };
    });
  }
  return { wrap, summary, clear() { generation++; samples.length = 0; } };
}
