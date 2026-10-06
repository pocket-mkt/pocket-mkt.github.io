import { useCallback, useEffect, useRef, useState } from "react";
import {
  METRICS,
  numberValue,
  validateDaily,
  sameDaily,
} from "./kpiDailyModel.js";

export function normalizedDaily(kind, draft) {
  const body = structuredClone(draft);
  for (const k of kind === "SETTINGS"
    ? ["inflow_goal", "conversion_goal"]
    : ["visits", "conversions"])
    body[k] = numberValue(body[k], kind === "SETTINGS");
  if (kind === "DAY")
    for (const c of body.channels)
      for (const k of METRICS) c[k] = numberValue(c[k]);
  return validateDaily(kind, body);
}

// The draft stays in component memory. One acknowledged record/version at a time,
// with an immutable retry envelope if a response is lost.
export function useKpiDailyDraft({
  initial,
  kind,
  date,
  source,
  projectId,
  onSaved,
  register,
  canWrite,
}) {
  const [draft, setDraft] = useState(initial.body),
    [status, setStatus] = useState("saved"),
    [error, setError] = useState(null);
  const draftRef = useRef(initial.body),
    saved = useRef(initial),
    request = useRef(null),
    blocked = useRef(false),
    flight = useRef(null),
    alive = useRef(true),
    callbacks = useRef({ onSaved }),
    flushRef = useRef();
  callbacks.current = { onSaved };
  const change = useCallback((update) => {
    const next =
      typeof update === "function" ? update(draftRef.current) : update;
    draftRef.current = next;
    setDraft(next);
    setStatus("dirty");
    setError(null);
  }, []);
  const flush = useCallback(async () => {
    if (flight.current) {
      if (!(await flight.current)) return false;
      return flushRef.current();
    }
    if (!canWrite) return true;
    if (blocked.current) return false;
    let body;
    try {
      body = normalizedDaily(kind, draftRef.current);
    } catch (e) {
      setError(e);
      setStatus("error");
      return false;
    }
    if (sameDaily(body, saved.current.body) && !request.current) {
      setStatus("saved");
      return true;
    }
    // Do not replace a failed request with another payload: first resolve the old write.
    const pending = request.current || {
      projectId,
      kind,
      date,
      body,
      rowVersion: saved.current.row_version ?? null,
      mutationId: crypto.randomUUID(),
    };
    request.current = pending;
    setStatus("saving");
    setError(null);
    const promise = (async () => {
      try {
        const result = await source.saveKpiDaily(pending);
        if (!alive.current) return false;
        const item = result.data.item;
        saved.current = item;
        request.current = null;
        callbacks.current.onSaved(item);
        if (result.data.replayed && !sameDaily(item.body, pending.body)) {
          request.current = pending;
          throw Object.assign(
            new Error(
              "재시도 사이에 다른 수정이 저장되었습니다. 입력을 백업한 뒤 최신 기록과 비교해 주세요.",
            ),
            { code: "conflict" },
          );
        }
        if (sameDaily(normalizedDaily(kind, draftRef.current), pending.body)) {
          draftRef.current = item.body;
          setDraft(item.body);
          setStatus("saved");
        } else setStatus("dirty");
        return true;
      } catch (e) {
        if (alive.current) {
          if (e.code === "22023") request.current = null;
          if (e.code === "conflict" || e.code === "forbidden")
            blocked.current = true;
          setError(e);
          setStatus("error");
        }
        return false;
      } finally {
        flight.current = null;
      }
    })();
    flight.current = promise;
    const ok = await promise;
    if (
      ok &&
      alive.current &&
      !sameDaily(normalizedDaily(kind, draftRef.current), saved.current.body)
    )
      return flushRef.current();
    return ok;
  }, [canWrite, source, projectId, kind, date]);
  flushRef.current = flush;
  useEffect(() => {
    alive.current = true;
    const guard = {
      flush,
      update: async (transform) => {
        change(transform);
        return flush();
      },
      dirty: () =>
        !sameDaily(draftRef.current, saved.current.body) || !!request.current,
      pending: () => !!flight.current,
    };
    const unregister = register?.(kind, guard);
    return () => {
      alive.current = false;
      unregister?.();
    };
  }, [flush, register, kind, change]);
  // After resolving an uncertain retry, save any subsequent draft separately.
  useEffect(() => {
    if (status !== "dirty") return;
    const timer = setTimeout(() => {
      if (!document.activeElement?.closest('[data-kpi-editor="' + kind + '"]'))
        flush();
    }, 800);
    return () => clearTimeout(timer);
  }, [status, flush, kind]);
  return {
    draft,
    change,
    flush,
    status,
    error,
    kind,
    date,
    locked: status === "error" && !!request.current,
    dirty: status !== "saved",
  };
}
