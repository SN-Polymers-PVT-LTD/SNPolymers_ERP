import React, { useEffect, useRef, useState } from 'react';
import { lookupBeneficiary } from '../../api/acctRequisitionsApi';

/**
 * Debounced (account_number, ifsc) lookup. On a hit, shows an inline
 * confirmation instead of silently overwriting fields the Accounts user may
 * already be mid-typing.
 */
const BeneficiaryAutofill = ({ accountNumber, ifsc, onAutofill }) => {
  const [match, setMatch] = useState(null);
  const [dismissedKey, setDismissedKey] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    if (!accountNumber?.trim() || !ifsc?.trim()) {
      setMatch(null);
      return;
    }

    const key = `${accountNumber}|${ifsc}`;
    if (key === dismissedKey) return;

    timerRef.current = setTimeout(async () => {
      try {
        const res = await lookupBeneficiary({ account_number: accountNumber, ifsc });
        setMatch(res.data?.beneficiary || null);
      } catch {
        setMatch(null);
      }
    }, 500);

    return () => clearTimeout(timerRef.current);
  }, [accountNumber, ifsc, dismissedKey]);

  if (!match) return null;

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
          setMatch(null);
        }}
      >
        Dismiss
      </button>
    </div>
  );
};

export default BeneficiaryAutofill;
