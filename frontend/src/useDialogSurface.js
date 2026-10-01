import { useEffect } from 'react';
import { acquireBodyScrollLock } from './bodyScrollLock.js';

// Keep the existing tree mounted: Gantt selection, gestures and row windows survive.
export function useDialogSurface(open, ref, onClose) {
  useEffect(() => {
    if (!open || !ref.current) return;
    const surface = ref.current;
    const previous = document.activeElement;
    const release = acquireBodyScrollLock();
    const focusable = () => [...surface.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],iframe,[tabindex="0"]')].filter(el => el.getClientRects().length);
    (surface.querySelector('[data-dialog-close]') || focusable()[0] || surface).focus();
    const handle = event => {
      // A nested editor or portal menu owns its own dismissal and focus handling.
      const nested = document.querySelector('.modal-backdrop [role="dialog"]');
      if ((nested && nested !== surface) || document.querySelector('.task-choice-menu')) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (event.key === 'Tab') {
        const items = focusable(), first = items[0], last = items.at(-1);
        if (!items.length) { event.preventDefault(); surface.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !surface.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !surface.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handle);
    return () => { document.removeEventListener('keydown', handle); release(); if (previous?.isConnected) previous.focus(); };
  }, [open, ref, onClose]);
}
