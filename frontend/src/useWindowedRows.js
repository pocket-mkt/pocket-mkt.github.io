import { useLayoutEffect, useRef, useState } from "react";

export function rowWindow(items, heights, scrollTop, viewportHeight, estimate = 48, pinnedId = null, overscan = 8) {
  const offsets = [0];
  for (const item of items) offsets.push(offsets.at(-1) + (heights.get(String(item.id)) || (typeof estimate === "function" ? estimate(item) : estimate)));
  let start = 0;
  while (start < items.length && offsets[start + 1] < scrollTop) start++;
  let end = start;
  while (end < items.length && offsets[end] < scrollTop + viewportHeight) end++;
  start = Math.max(0, start - overscan); end = Math.min(items.length, end + overscan);
  const pinned = items.findIndex(item => String(item.id) === pinnedId);
  if (pinned >= 0) { start = Math.min(start, pinned); end = Math.max(end, pinned + 1); }
  return { start, end, before: offsets[start], after: offsets.at(-1) - offsets[end] };
}

// Measured row heights preserve multi-line content; focused editors remain
// mounted. Small lists and active native drags keep the original full DOM.
export function useWindowedRows(items, containerRef, { estimate = 48, disabled = false } = {}) {
  const heights = useRef(new Map());
  const [viewport, setViewport] = useState({ top: 0, height: 700, pinned: null });
  const [, setRevision] = useState(0);
  const enabled = items.length > 200 && !disabled;
  const range = enabled ? rowWindow(items, heights.current, viewport.top, viewport.height, estimate, viewport.pinned) : { start: 0, end: items.length, before: 0, after: 0 };
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return undefined;
    let frame = null;
    const update = () => {
      frame = null;
      const top = container.scrollTop, height = container.clientHeight || 700;
      const focused = container.contains(document.activeElement) ? document.activeElement.closest('[data-window-id]')?.dataset.windowId || null : null;
      setViewport(previous => previous.top === top && previous.height === height && previous.pinned === focused ? previous : {top, height, pinned: focused});
    };
    const schedule = () => { if (frame === null) frame = requestAnimationFrame(update); };
    update();
    const observer = new ResizeObserver(schedule);observer.observe(container);
    container.addEventListener('scroll', schedule, {passive: true});
    container.addEventListener('focusin', schedule);container.addEventListener('focusout', schedule);
    return () => { if (frame !== null) cancelAnimationFrame(frame); observer.disconnect();container.removeEventListener('scroll',schedule);container.removeEventListener('focusin',schedule);container.removeEventListener('focusout',schedule); };
  }, [enabled, containerRef]);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!enabled || !container) return undefined;
    const observer = new ResizeObserver(entries => {
      let changed = false;
      for (const entry of entries) {
        const id = entry.target.dataset.windowId, height = entry.target.getBoundingClientRect().height;
        if (height > 0 && Math.abs((heights.current.get(id) || 0) - height) > 1) { heights.current.set(id, height); changed = true; }
      }
      if (changed) setRevision(value => value + 1);
    });
    container.querySelectorAll('[data-window-id]').forEach(row => observer.observe(row));
    return () => observer.disconnect();
  }, [enabled, items, range.start, range.end, containerRef]);
  return range;
}
