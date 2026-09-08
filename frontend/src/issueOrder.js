function createdTime(issue) {
  for (const value of [issue.createdAt, issue.date]) {
    if (!value) continue;
    const text = String(value);
    const time = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00+09:00` : text);
    if (Number.isFinite(time)) return time;
  }
  return -Infinity;
}

export function newestIssuesFirst(items) {
  return [...items].sort((left, right) => {
    const leftTime = createdTime(left);
    const rightTime = createdTime(right);
    return leftTime === rightTime ? 0 : leftTime > rightTime ? -1 : 1;
  });
}
