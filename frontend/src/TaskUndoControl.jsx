import { useEffect } from 'react';
import { Undo2 } from 'lucide-react';

export function canHandleTaskUndo(event) {
  return (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'z'
    && !event.defaultPrevented && !event.target?.closest?.('input,textarea,select,[contenteditable="true"],[role="dialog"]');
}

export default function TaskUndoControl({ entry, busy, onUndo }) {
  useEffect(() => {
    const handler = event => {
      if (!entry || busy || !canHandleTaskUndo(event) || document.querySelector('[role="dialog"],.modal-backdrop')) return;
      event.preventDefault(); onUndo();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [entry, busy, onUndo]);
  return <button type="button" className="secondary-button task-undo-button" disabled={!entry || busy} onClick={onUndo}
    title={entry ? `직전 업무 변경 ${entry.ids.length}건 되돌리기 (Ctrl+Z)` : '이 탭에서 저장한 직전 업무 변경을 되돌립니다'}>
    <Undo2 size={16} /><span>{busy ? '되돌리는 중' : '되돌리기'}</span>
  </button>;
}
