import { useId, useRef, useState } from 'react';

export default function InPageSelect({ label, value, options, disabled, required, inline = false, onChange }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const trigger = useRef(null);
  const menu = useRef(null);
  const choose = next => {
    onChange(String(next));
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <div className="relative min-w-0 flex-1" onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }} onKeyDown={event => {
      if (!open) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const items = Array.from(menu.current?.querySelectorAll('button') || []);
        const current = items.indexOf(document.activeElement);
        const next = event.key === 'ArrowDown' ? current + 1 : current < 0 ? items.length - 1 : current - 1;
        items[(next + items.length) % items.length]?.focus();
      }
    }}>
      <label htmlFor={id} className="mb-2 block text-xs font-semibold uppercase tracking-wider">{label} {required && <span aria-hidden="true">*</span>}</label>
      <button
        ref={trigger}
        id={id}
        type="button"
        disabled={disabled}
        aria-expanded={open && !disabled}
        aria-controls={open && !disabled ? id + '-options' : undefined}
        className="glass-input flex w-full items-center justify-between gap-4 rounded-xl px-4 py-3 text-left font-semibold"
        onClick={() => setOpen(current => !current)}
        onKeyDown={event => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {options.find(option => String(option.value) === String(value))?.label}
        <svg aria-hidden="true" className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && !disabled && (
        <div ref={menu} data-select-menu-open id={id + '-options'} role="group" aria-label={label + ' options'} className={`${inline ? "" : "absolute z-30"} mt-1 max-h-56 w-full overflow-auto rounded-xl border border-slate-200 bg-white p-1 text-slate-900 shadow-lg [body.dark_&]:border-slate-700 [body.dark_&]:bg-slate-900 [body.dark_&]:text-white`}>
          {options.map(option => (
            <button key={option.value} type="button" aria-pressed={String(option.value) === String(value)}
              className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-indigo-100 focus-visible:bg-indigo-100 aria-pressed:font-bold [body.dark_&]:hover:bg-indigo-900 [body.dark_&]:focus-visible:bg-indigo-900"
              onClick={() => choose(option.value)}>
              {option.label}{option.detail}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
