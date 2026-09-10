import { taskSortCycles } from './taskLocalSort.js';

export default function TaskSortHeading({ field, label, rules, onCycle, disabled }) {
  const priority = rules.findIndex(rule => rule.field === field);
  const active = taskSortCycles[field].find(([value]) => value === rules[priority]?.value)?.[1];
  return <th aria-sort={active ? 'other' : 'none'}>
    <button type="button" className={`task-local-sort${active ? ' is-active' : ''}`} disabled={disabled}
      data-sort-field={field} onClick={() => onCycle(field)}
      aria-label={`${label} 정렬: ${active ? `${active} 우선, ${priority + 1}순위` : '기본값'}`}
      title="내 화면에서만 정렬합니다. 새로고침·프로젝트 변경 시 초기화됩니다.">
      <span>{label} {active ? '↑' : '↕'}</span>
      {active && <small>{priority + 1} · {active} 우선</small>}
    </button>
  </th>;
}
