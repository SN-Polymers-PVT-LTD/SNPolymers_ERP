import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Input from '../ui/Input';
import { searchBeneficiariesByAcNo } from '../../api/acctRequisitionsApi';

const MIN_PREFIX_LENGTH = 3;
const DEBOUNCE_MS = 300;
const MENU_MAX_HEIGHT = 224; // px, matches max-h-56

/**
 * Wraps the line-item entry row's "A/C No." Input with a live typeahead of
 * previously-used beneficiaries whose account number starts with what's
 * been typed so far (searchBeneficiariesByAcNo — a left-anchored prefix
 * match, most-recently-used first, distinct from getBeneficiaries'
 * substring/alphabetical search that backs the Beneficiary Master page).
 *
 * Mirrors SearchableSelect.jsx's portal/positioning/outside-click pattern
 * (fixed-position dropdown via createPortal, above/below flip, global
 * mousedown listener) so it behaves consistently inside the table row —
 * but fetches async instead of filtering a preloaded options list, since
 * beneficiary_master isn't preloaded the way the tiny, admin-curated
 * account_sub_title_master/particulars_master lists are.
 *
 * Unlike BeneficiaryAutofill (which only ever fills beneficiary_name/
 * beneficiary_bank_name once BOTH account number and IFSC are already fully
 * typed), picking a suggestion here fills in the whole beneficiary block —
 * account number, IFSC, name, and bank — since the point is completing a
 * still-partial account number.
 */
const BeneficiaryAcNoSuggestions = ({ value, onChange, onSelect, disabled = false, ...inputProps }) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [menuRect, setMenuRect] = useState(null);
  const containerRef = useRef(null);
  const menuRef = useRef(null);
  const requestIdRef = useRef(0);
  // Set right before handlePick changes `value` via onSelect, so the very
  // next effect run (caused by that same selection, not by typing) skips
  // reopening/refetching entirely — otherwise, whenever the picked
  // suggestion's account number differs from what was actually typed so far
  // (completing a partial prefix), the resulting value change re-triggers
  // this effect and its `setOpen(true)` immediately undoes handlePick's own
  // setOpen(false), reopening the menu right after a selection.
  const justSelectedRef = useRef(false);

  useEffect(() => {
    if (justSelectedRef.current) {
      justSelectedRef.current = false;
      return undefined;
    }

    const prefix = value.trim();
    if (prefix.length < MIN_PREFIX_LENGTH) {
      setResults([]);
      setLoading(false);
      setOpen(false);
      return undefined;
    }

    // Re-opens on every prefix change of 3+ chars, not just the initial
    // focus — the first 1-2 keystrokes above forced `open` closed (setOpen
    // isn't otherwise re-triggered on this path), so without this the menu
    // stayed closed for the rest of a normal continuous typing flow even
    // though results were being fetched correctly in the background.
    setOpen(true);
    const requestId = ++requestIdRef.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await searchBeneficiariesByAcNo(prefix);
        // A slower, earlier request must never clobber a newer one's results.
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
        width: Math.max(rect.width, 240),
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

  const showMenu = open && !disabled && value.trim().length >= MIN_PREFIX_LENGTH;

  return (
    <div ref={containerRef} className="relative">
      <Input
        {...inputProps}
        value={value}
        disabled={disabled}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={onChange}
      />

      {showMenu && menuRect && createPortal(
        <div
          ref={menuRef}
          className="fixed z-50 max-h-56 overflow-y-auto rounded-xl border border-white/10 bg-[#0d131f] shadow-xl"
          style={{
            left: menuRect.left,
            width: menuRect.width,
            ...(menuRect.flip ? { bottom: menuRect.bottom } : { top: menuRect.top })
          }}
        >
          {loading && (
            <p className="px-4 py-3 text-xs text-slate-500">Searching…</p>
          )}
          {!loading && results.length === 0 && (
            <p className="px-4 py-3 text-xs text-slate-500">No matches.</p>
          )}
          {!loading && results.map((b) => (
            <button
              key={`${b.account_number}|${b.ifsc}`}
              type="button"
              className="w-full text-left px-4 py-2.5 hover:bg-white/5 transition border-b border-white/5 last:border-b-0"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handlePick(b)}
            >
              <p className="text-xs font-bold text-slate-200">{b.account_number}</p>
              <p className="text-[10px] text-slate-400">{b.beneficiary_name} &middot; {b.beneficiary_bank_name}</p>
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
};

export default BeneficiaryAcNoSuggestions;
