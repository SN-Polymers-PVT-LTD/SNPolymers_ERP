import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  disabled = false
}) => {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
        autoComplete="off"
        size={size}
        onFocus={() => setOpen(true)}
        onChange={(e) => { onChange?.(e.target.value); setOpen(true); }}
      />

      {open && !disabled && (
        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto rounded-xl border border-white/10 bg-[#0d131f] shadow-xl">
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
        </div>
      )}
    </div>
  );
};

export default SearchableSelect;
