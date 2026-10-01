// Reuse this visible scope's authored positions. Rows in unselected months
// never receive a mutation, even when order numbers span multiple months.
export function scopedTaskSortOrders(ordered, allTasks) {
  let slots=ordered.map(task=>Number(task.sortOrder));
  if (slots.some(value=>!Number.isSafeInteger(value)) || new Set(slots).size!==slots.length) {
    const last=Math.max(0,...allTasks.map(task=>Number(task.sortOrder)||0));
    slots=ordered.map((_,index)=>last+(index+1)*10);
  } else slots.sort((a,b)=>a-b);
  if(slots.some(value=>value>2147483647 || value<0))throw Error('업무 순서 값의 범위를 확인해 주세요.');
  return slots;
}
