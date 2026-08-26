import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Input from './Input';

/**
 * Combobox: a controlled text Input (value/onChange are the free-typed query)
 * with a filtered dropdown of {value,label} options below it. Picking an
 * option fires onSelect. If onCreate is supplied and the typed text has no
 * exact (case-insensitive) match among options, an "Add" row offers to create
 * it — for master lists the Accounts role can extend inline (no fixed enum).
 */
const SearchableSelect = ({
  label,
  required = false,
  helperText,
  error,
  value = '',
  onChange,
  options = [],
  onSelect,
  onCreate,
  createLabel = (q) => `+ Add "${q}" as new`,
  placeholder,
  containerClassName = '',
  size = 'md',
  disabled = false,
  autoFocus = false
}) => {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [menuRect, setMenuRect] = useState(null);
  const containerRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    // menuRef is checked too: the dropdown now renders through a portal
    // (see below), so it's no longer a DOM descendant of containerRef —
    // without this, a click on an option would count as "outside" and close
    // the menu before its own onClick had a chance to fire.
    const handleClickOutside = (e) => {
      if (containerRef.current?.contains(e.target)) return;
      if (menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Rendered through a portal (see below) instead of nested inside the
  // table's own DOM, so position is tracked in viewport coordinates rather
  // than relying on CSS position:absolute + z-index within the table's own
  // stacking context. Flips above the input (instead of always opening
  // downward) when the row is near the bottom of the viewport and there
  // isn't room below for the menu — otherwise it just runs off-screen for
  // the last row(s) in the table.
  const MENU_MAX_HEIGHT = 224; // px, matches max-h-56
  useLayoutEffect(() => {
    if (!open) return undefined;

    const updateRect = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const flip = spaceBelow < MENU_MAX_HEIGHT && spaceAbove > spaceBelow;
      setMenuRect({
        left: rect.left,
        width: rect.width,
        flip,
        top: flip ? undefined : rect.bottom + 4,
        bottom: flip ? window.innerHeight - rect.top + 4 : undefined
      });
    };

    updateRect();
    window.addEventListener('scroll', updateRect, true);
    window.addEventListener('resize', updateRect);
    return () => {
      window.removeEventListener('scroll', updateRect, true);
      window.removeEventListener('resize', updateRect);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => o.label.toLowerCase().includes(q));
  }, [options, value]);

  const exactMatch = options.some(o => o.label.trim().toLowerCase() === value.trim().toLowerCase());

  const handlePick = (opt) => {
    onSelect?.(opt);
    setOpen(false);
  };

  const handleCreate = async () => {
    const query = value.trim();
    if (!query || !onCreate) return;
    setCreating(true);
    setCreateError('');
    try {
      const created = await onCreate(query);
      onSelect?.(created);
      setOpen(false);
    } catch (err) {
      setCreateError(err.response?.data?.message || 'Failed to create.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div ref={containerRef} className={`relative ${containerClassName}`}>
      <Input
        label={label}
        required={required}
        helperText={createError || helperText}
        error={error}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        size={size}
        onFocus={() => setOpen(true)}
        onChange={(e) => { onChange?.(e.target.value); setOpen(true); }}
      />

      {open && !disabled && menuRect && createPortal(
        <div
          ref={menuRef}
          className="fixed z-50 max-h-56 overflow-y-auto rounded-xl border border-white/10 bg-[#0d131f] shadow-xl"
          style={{
            left: menuRect.left,
            width: menuRect.width,
            ...(menuRect.flip ? { bottom: menuRect.bottom } : { top: menuRect.top })
          }}
        >
          {filtered.length === 0 && !onCreate && (
            <p className="px-4 py-3 text-xs text-slate-500">No matches.</p>
          )}
          {filtered.map(opt => (
            <button
              key={opt.value}
              type="button"
              className="w-full text-left px-4 py-2.5 text-xs font-semibold text-slate-200 hover:bg-white/5 transition"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handlePick(opt)}
            >
              {opt.label}
            </button>
          ))}
          {onCreate && value.trim() && !exactMatch && (
            <button
              type="button"
              className="w-full text-left px-4 py-2.5 text-xs font-bold text-amber-400 hover:bg-amber-500/10 transition border-t border-white/5 disabled:opacity-50"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleCreate}
              disabled={creating}
            >
              {creating ? 'Adding…' : createLabel(value.trim())}
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  );
};

export default SearchableSelect;
