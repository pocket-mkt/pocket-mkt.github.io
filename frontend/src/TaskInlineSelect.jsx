import { Children, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./taskInlineSelect.css";

// A shared popup avoids native option styling differences and scroll-container clipping.
export default function TaskInlineSelect({ children, value, onChange, disabled, className = "", ...props }) {
  const options = Children.toArray(children);
  const trigger = useRef(null);
  const menu = useRef(null);
  const id = useId();
  const [position, setPosition] = useState(null);
  const selected = Math.max(0, options.findIndex(option => option.props.value === value));
  const close = (restore = false) => { setPosition(null); if (restore) trigger.current?.focus(); };
  useEffect(() => {
    if (!position) return;
    menu.current?.querySelectorAll('[role="menuitemradio"]')[selected]?.focus();
    const outside = event => {
      if (!menu.current?.contains(event.target) && !trigger.current?.contains(event.target)) setPosition(null);
    };
    const dismiss = event => { if (!menu.current?.contains(event.target)) setPosition(null); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [position, selected]);
  useEffect(() => { if (disabled) setPosition(null); }, [disabled]);
  function open() {
    if (disabled) return;
    const rect = trigger.current.getBoundingClientRect();
    const width = Math.min(156, window.innerWidth - 16);
    const height = options.length * 38 + 12;
    setPosition({ left: Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 8)), top: Math.max(8, rect.bottom + height + 6 <= window.innerHeight ? rect.bottom + 6 : rect.top - height - 6), width });
  }
  return <>
    <button {...props} ref={trigger} type="button" disabled={disabled} className={`${className} task-choice-trigger`} aria-haspopup="menu" aria-expanded={Boolean(position)} aria-controls={position ? id : undefined}
      onClick={() => position ? close() : open()}
      onKeyDown={event => { if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); open(); } }}>
      <span>{options[selected]?.props.children}</span><span aria-hidden="true" className="task-choice-chevron">⌄</span>
    </button>
    {position && createPortal(<div id={id} ref={menu} role="menu" aria-label={props["aria-label"]} className="task-choice-menu" style={position} onPointerDown={event => event.stopPropagation()}
      onKeyDown={event => {
        const buttons = [...menu.current.querySelectorAll('[role="menuitemradio"]')];
        const index = buttons.indexOf(document.activeElement);
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next]?.focus();
        }
      }}>
      {options.map(option => <button key={option.props.value} type="button" role="menuitemradio" aria-checked={option.props.value === value} tabIndex={-1} onClick={event => {
        event.stopPropagation(); close(true);
        if (!disabled && option.props.value !== value) onChange({ target: { value: option.props.value } });
      }}><span>{option.props.children}</span><span aria-hidden="true">{option.props.value === value ? "✓" : ""}</span></button>)}
    </div>, document.body)}
  </>;
}
