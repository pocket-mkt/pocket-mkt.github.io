// One pass over the list per batch, rather than one list scan and storage
// serialization per changed row. A null updater result archives that row.
export function applyTaskChanges(state, projectId, changes) {
  if (state.resource !== "tasks" || state.projectId !== projectId || !state.data?.items || !changes.size) return state;
  let changed = false, removed = 0;
  const items = [];
  for (const item of state.data.items) {
    const update = changes.get(item.id);
    const next = update ? update(item) : item;
    if (next !== item) changed = true;
    if (next === null) removed++;
    else items.push(next);
  }
  return changed ? { ...state, data: { ...state.data, items, total: Math.max(0, Number(state.data.total ?? state.data.items.length) - removed) } } : state;
}

export function restoreTaskChanges(state, projectId, originals, selectedIds) {
  if (state.resource !== "tasks" || state.projectId !== projectId || !state.data?.items) return state;
  const previous = new Map(originals.filter(item => selectedIds.has(item.id)).map(item => [item.id, item]));
  const current = new Map(state.data.items.map(item => [item.id, item]));
  const items = originals.filter(item => previous.has(item.id) || current.has(item.id)).map(item => previous.get(item.id) || current.get(item.id));
  const originalIds = new Set(originals.map(item => item.id));
  items.push(...state.data.items.filter(item => !originalIds.has(item.id)));
  return { ...state, data: { ...state.data, items, total: Number(state.data.total ?? state.data.items.length) + items.length - state.data.items.length } };
}
