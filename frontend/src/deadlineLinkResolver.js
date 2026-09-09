// Page-scoped compatibility reader while the aggregate omits completion_url.
// Share one read per displayed project, with at most three requests in flight.
export function createDeadlineLinkResolver(readProject) {
  const projects = new Map();
  const queue = [];
  let active = 0;
  const pump = () => {
    while (active < 3 && queue.length) {
      const { projectId, resolve, reject } = queue.shift();
      active++;
      Promise.resolve().then(() => readProject(projectId)).then(resolve, reject).finally(() => { active--; pump(); });
    }
  };
  return async task => {
    const key = String(task.projectId);
    if (!projects.has(key)) {
      const pending = new Promise((resolve, reject) => { queue.push({ projectId: task.projectId, resolve, reject }); });
      projects.set(key, pending);
      pending.catch(() => { if (projects.get(key) === pending) projects.delete(key); });
      pump();
    }
    const rows = await projects.get(key);
    const current = rows.find(row => String(row.id) === String(task.id));
    if (!current) throw new Error('업무 조회 불가');
    return current.completionUrl || '';
  };
}
