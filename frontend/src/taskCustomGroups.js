import { taskScheduleDates } from './taskGantt.js';

// Group headers are display rows only: never tasks, never saved schedules.
export function customTaskRows(tasks, expanded = new Set()) {
  const groups = new Map();
  for (const task of tasks) if (task.taskGroupId) {
    if (!groups.has(task.taskGroupId)) groups.set(task.taskGroupId, []);
    groups.get(task.taskGroupId).push(task);
  }
  const emitted = new Set();
  return tasks.flatMap(task => {
    if (!task.taskGroupId) return [{ id: task.id, task }];
    if (emitted.has(task.taskGroupId)) return [];
    emitted.add(task.taskGroupId);
    const members = groups.get(task.taskGroupId);
    const group = {
      id: task.taskGroupId, name: task.taskGroupName || '업무 그룹', tasks: members,
      dates: new Set(members.flatMap(taskScheduleDates)),
      done: members.filter(item => item.statusCode === 'DONE').length,
    };
    return [{ id: `custom:${group.id}`, customGroup: group },
      ...(expanded.has(group.id) ? members.map(item => ({ id: item.id, task: item })) : [])];
  });
}

export function groupTaskUpdates(tasks, name, id) {
  if (!tasks.length || tasks.length > 40) throw new Error('한 번에 1~40개 업무를 선택해 주세요.');
  const clean = String(name || '').trim();
  if (id && (!clean || clean.length > 100)) throw new Error('그룹 이름을 1~100자로 입력해 주세요.');
  return tasks.map(task => ({ task, fields: { task_group_id: id || null, task_group_name: id ? clean : null } }));
}
