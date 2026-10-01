import React, { useState } from 'react';
import { TaskScheduleTimeline } from '../src/TaskWorkspace.jsx';
import { taskMonthKey, shiftTaskMonth, taskMonthLabel } from '../src/taskMonth.js';

export async function runTaskMonthQa(render, tick, check) {
  const current = taskMonthKey(new Date());
  const previous = shiftTaskMonth(current, -1);
  const tasks = [
    { id: 'old-active', title: '이전 월 미완료', executionMonth: previous + '-01', statusCode: 'IN_PROGRESS' },
    { id: 'current', title: '당월 업무', executionMonth: current + '-01', statusCode: 'NOT_STARTED' },
    { id: 'old-done', title: '이전 월 업무 · 당월 완료', executionMonth: previous + '-01', statusCode: 'DONE', completedDate: current + '-02' },
  ].map(task => ({ ...task, streamCode: 'MARKETING', categoryCode: 'NAVER', responsibleOrgCode: 'NS',
    plannedStartDate: previous + '-20', dueDate: current + '-05', scheduleDates: [previous + '-20', current + '-05'], visibilityCode: 'CLIENT' }));
  const before = JSON.stringify(tasks);
  let writes = 0;
  function Fixture({ projectId, client = false }) {
    const [mode, setMode] = useState(client ? 'gantt' : 'table');
    return <TaskScheduleTimeline tasks={tasks} issues={[]} project={{ id: projectId, clientName: 'QA' }} query=""
      canWrite={!client} summaryOnly={client} showOwners={!client} displayMode={mode} onViewChange={setMode}
      onUpdate={async () => { writes++; }} onBatchUpdate={async () => { writes++; }} />;
  }
  const button = month => document.querySelector(`[data-execution-month="${month}"]`);
  const ids = () => [...document.querySelectorAll('.reference-task-row,.g-row[data-window-id]')].map(row => row.dataset.windowId).sort();
  const expect = (wanted, message) => check(JSON.stringify(ids()) === JSON.stringify([...wanted].sort()), message + ': ' + JSON.stringify(ids()));
  const toggle = async month => { button(month).click(); await tick(); };
  for (const client of [false, true]) {
    await render(<div />); await render(<Fixture projectId="months" client={client} />);
    check(button(current)?.getAttribute('aria-pressed') === 'true' && button(previous)?.getAttribute('aria-pressed') === 'false', 'default month selection');
    expect(['current'], 'current month excludes unfinished and cross-month previous work');
    check(document.querySelector('.task-month-selection').textContent.includes(taskMonthLabel(current)), 'selected month label');
    await toggle(previous);
    expect(['old-active', 'current', 'old-done'], 'both months union without duplicates');
    check(document.querySelectorAll('.task-month-buttons [aria-pressed="true"]').length === 2, 'both month buttons selected');
    const badges = [...document.querySelectorAll('.task-month-badge')].map(badge => badge.textContent);
    check(badges.filter(label => label === taskMonthLabel(previous, true)).length === 2 && badges.includes(taskMonthLabel(current, true)), 'actual task months shown');
    if (!client) {
      document.querySelector('[aria-label="표시된 업무 전체 선택"]').click(); await tick();
      await toggle(current);
      check(!document.querySelector('.task-bulk-toolbar'), 'month change clears hidden bulk selection');
    } else await toggle(current);
    expect(['old-active', 'old-done'], 'previous month only');
    await toggle(previous);
    expect([], 'no selected month must not reveal all tasks');
    check(document.body.textContent.includes('진행 월을 선택해 주세요'), 'explicit no-month empty state');
    await toggle(current); await toggle(previous);
    if (!client) {
      [...document.querySelectorAll('.task-workspace-tabs button')].find(button => button.textContent === '간트').click(); await tick();
      expect(['old-active', 'current', 'old-done'], 'selection survives table to Gantt switch');
      await toggle(previous); expect(['current'], 'Gantt current month only');
      await render(<Fixture projectId="other-project" />);
      check(button(current).getAttribute('aria-pressed') === 'true' && button(previous).getAttribute('aria-pressed') === 'false', 'project change resets selection');
    } else {
      check(!document.querySelector('.task-done-check,.g-action,.reference-task-select,.task-bulk-toolbar'), 'customer remains read only');
    }
    check(document.documentElement.scrollWidth <= innerWidth + 1, 'month controls overflow viewport');
  }
  check(writes === 0 && JSON.stringify(tasks) === before, 'month selection changed shared task data');
  return ['single/multiple/empty month selection, strict stored-month scope, table/Gantt persistence, customer read-only, zero writes'];
}
