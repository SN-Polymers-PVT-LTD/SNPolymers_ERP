import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Input } from '../ui';
import { searchProjectsBeneficiaries } from '../../api/requisitionsApi';

const MIN_PREFIX_LENGTH = 3;
const DEBOUNCE_MS = 300;
const MENU_MAX_HEIGHT = 224;

/**
 * ProjectBeneficiarySuggestions
 * Typeahead suggestions for Project Payment Requisitions based on projects_beneficiary_master.
 * When typing an account number (or payee name), suggests previously used beneficiaries,
 * ordered by most recently used. Selecting an item auto-populates A/C, IFSC, Name, and Bank.
 */
const ProjectBeneficiarySuggestions = ({
  value = '',
  onChange,
  onSelect,
  disabled = false,
  label = 'Account No.',
  placeholder = 'Enter account number…',
  ...inputProps
}) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [menuRect, setMenuRect] = useState(null);
  const containerRef = useRef(null);
  const menuRef = useRef(null);
  const requestIdRef = useRef(0);
  const justSelectedRef = useRef(false);

  useEffect(() => {
    if (justSelectedRef.current) {
      justSelectedRef.current = false;
      return undefined;
    }

    const prefix = (value || '').trim();
    if (prefix.length < MIN_PREFIX_LENGTH) {
      setResults([]);
      setLoading(false);
      setOpen(false);
      return undefined;
    }

    setOpen(true);
    const requestId = ++requestIdRef.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await searchProjectsBeneficiaries(prefix);
        if (requestId !== requestIdRef.current) return;
        setResults(res.data?.beneficiaries || []);
      } catch {
        if (requestId !== requestIdRef.current) return;
        setResults([]);
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current?.contains(e.target)) return;
      if (menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
        width: Math.max(rect.width, 260),
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

  const handlePick = (beneficiary) => {
    justSelectedRef.current = true;
    onSelect?.(beneficiary);
    setOpen(false);
    setResults([]);
  };

  const showMenu = open && !disabled && (value || '').trim().length >= MIN_PREFIX_LENGTH;

  return (
    <div ref={containerRef} className="relative">
      <Input
        label={label}
        value={value}
        disabled={disabled}
        autoComplete="off"
        placeholder={placeholder}
        onFocus={() => {
          if ((value || '').trim().length >= MIN_PREFIX_LENGTH) setOpen(true);
        }}
        onChange={onChange}
        {...inputProps}
      />

      {showMenu && menuRect && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[10000] max-h-56 overflow-y-auto rounded-xl border border-white/10 bg-[#0d131f] shadow-2xl backdrop-blur-md"
          style={{
            left: menuRect.left,
            width: menuRect.width,
            ...(menuRect.flip ? { bottom: menuRect.bottom } : { top: menuRect.top })
          }}
        >
          {loading && (
            <p className="px-4 py-3 text-xs text-slate-400 animate-pulse">Searching beneficiaries…</p>
          )}
          {!loading && results.length === 0 && (
            <p className="px-4 py-3 text-xs text-slate-500">No matching beneficiaries found.</p>
          )}
          {!loading && results.map((b) => (
            <button
              key={b.id || `${b.beneficiary_ac_no}|${b.beneficiary_ifsc}`}
              type="button"
              className="w-full text-left px-4 py-2.5 hover:bg-amber-500/10 transition border-b border-white/5 last:border-b-0 group"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handlePick(b)}
            >
              <p className="text-xs font-bold text-slate-200 group-hover:text-amber-400 transition">
                {b.beneficiary_ac_no}
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5 truncate">
                <span className="font-semibold text-slate-300">{b.beneficiary_name}</span>
                {(b.beneficiary_bank?.bank_name || b.beneficiary_bank_name) ? ` • ${b.beneficiary_bank?.bank_name || b.beneficiary_bank_name}` : ''}
                {b.beneficiary_ifsc ? ` (${b.beneficiary_ifsc})` : ''}
              </p>
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
};

export default ProjectBeneficiarySuggestions;
