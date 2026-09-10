import { taskScheduleStatusGroup } from './taskTimeline.js';

export const taskSortCycles = {
  status: [['DONE', '완료'], ['ACTIVE', '진행중'], ['DELAYED', '지연']],
  owner: [['NS', 'NS'], ['POCKET', '포켓']],
};

// First rule wins; returning one column to default removes only that rule.
export function cycleTaskLocalSort(rules, field) {
  const cycle = taskSortCycles[field];
  if (!cycle) return rules;
  const current = rules.find(rule => rule.field === field)?.value;
  const next = cycle[cycle.findIndex(([value]) => value === current) + 1];
  const others = rules.filter(rule => rule.field !== field);
  return next ? [{ field, value: next[0] }, ...others] : others;
}

export function sortTasksLocally(tasks, rules) {
  if (!rules.length) return tasks;
  const matches = (task, rule) => rule.field === 'status'
    ? taskScheduleStatusGroup(task) === rule.value
    : String(task.responsibleOrgCode || '').toUpperCase() === rule.value;
  return tasks.map((task, index) => ({ task, index })).sort((a, b) => {
    for (const rule of rules) {
      const difference = Number(matches(b.task, rule)) - Number(matches(a.task, rule));
      if (difference) return difference;
    }
    return a.index - b.index;
  }).map(({ task }) => task);
}
