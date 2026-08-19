import React, { useEffect, useRef, useState } from 'react';
import { lookupBeneficiary } from '../../api/acctRequisitionsApi';

/**
 * Debounced (account_number, ifsc) lookup. On a hit, shows an inline
 * confirmation instead of silently overwriting fields the Accounts user may
 * already be mid-typing.
 *
 * `sheetDismissedKeys`/`onSheetDismiss` are optional and, when supplied,
 * shared across every row in the sheet (lifted up by the parent): once a
 * given (account_number, ifsc) is confirmed or dismissed on any row, it
 * won't re-prompt on other rows referencing the same beneficiary — without
 * them this component still works standalone, dismissing only for itself.
 *
 * `currentName`/`currentBankName` are the row's own already-typed values.
 * The lookup still runs (there's no way to know it's a no-op without it),
 * but if the match is identical to what's already filled in, there's
 * nothing left to autofill — showing the prompt anyway is just noise.
 */
const BeneficiaryAutofill = ({ accountNumber, ifsc, onAutofill, sheetDismissedKeys, onSheetDismiss, currentName, currentBankName }) => {
  const [match, setMatch] = useState(null);
  const [lookupError, setLookupError] = useState(false);
  const [dismissedKey, setDismissedKey] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    if (!accountNumber?.trim() || !ifsc?.trim()) {
      setMatch(null);
      setLookupError(false);
      return;
    }

    const key = `${accountNumber}|${ifsc}`;
    if (key === dismissedKey || sheetDismissedKeys?.has(key)) {
      setMatch(null);
      setLookupError(false);
      return;
    }

    timerRef.current = setTimeout(async () => {
      try {
        const res = await lookupBeneficiary({ account_number: accountNumber, ifsc });
        setMatch(res.data?.beneficiary || null);
        setLookupError(false);
      } catch {
        // Distinct from "no match found": the request itself failed (network,
        // session expiry, server error). Surfacing this instead of silently
        // showing nothing is the whole point — a failed lookup and a genuine
        // no-match otherwise look identical to the user.
        setMatch(null);
        setLookupError(true);
      }
    }, 500);

    return () => clearTimeout(timerRef.current);
  }, [accountNumber, ifsc, dismissedKey, sheetDismissedKeys]);

  if (lookupError) {
    return (
      <p className="text-[10px] font-semibold text-red-400">
        Couldn't check for a matching beneficiary — try again in a moment.
      </p>
    );
  }

  if (!match) return null;

  const alreadyFilledIn =
    (currentName || '').trim().toLowerCase() === (match.beneficiary_name || '').trim().toLowerCase() &&
    (currentBankName || '').trim().toLowerCase() === (match.beneficiary_bank_name || '').trim().toLowerCase();
  if (alreadyFilledIn) return null;

  return (
    <div className="flex items-center gap-3 p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-xs">
      <span className="text-emerald-300">
        Found beneficiary: <span className="font-bold">{match.beneficiary_name}</span> ({match.beneficiary_bank_name})
      </span>
      <button
        type="button"
        className="text-emerald-400 font-bold underline underline-offset-2"
        onClick={() => {
          onAutofill?.(match);
          setDismissedKey(`${accountNumber}|${ifsc}`);
          onSheetDismiss?.(`${accountNumber}|${ifsc}`);
          setMatch(null);
        }}
      >
        Use this
      </button>
      <button
        type="button"
        className="text-slate-500 font-bold underline underline-offset-2"
        onClick={() => {
          setDismissedKey(`${accountNumber}|${ifsc}`);
          onSheetDismiss?.(`${accountNumber}|${ifsc}`);
          setMatch(null);
        }}
      >
        Dismiss
      </button>
    </div>
  );
};

export default BeneficiaryAutofill;
