import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, FormattedCurrencyInput } from '../ui';
import { upsertBankBalance } from '../../api/acctRequisitionsApi';

const formatCurrency = (val) =>
  val != null ? `₹ ${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—';

const todayISO = () => new Date().toISOString().slice(0, 10);

/**
 * Quick inline debit/credit adjuster for an existing bank — separate from
 * BankBalanceEditor (which handles creating a new bank / editing account
 * number via the "Add Bank" modal). This posts a delta against the current
 * balance rather than requiring the operator to type the full new figure.
 */
const BankCard = ({ bank, readOnly = false }) => {
  const queryClient = useQueryClient();
  const [adjusting, setAdjusting] = useState(false);
  const [direction, setDirection] = useState('credit');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const closeAdjuster = () => {
    setAdjusting(false);
    setAmount('');
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const delta = Number(amount);
    if (!amount || delta <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }

    const current = Number(bank.available_balance) || 0;
    const newBalance = direction === 'credit' ? current + delta : current - delta;
    if (newBalance < 0) {
      setError('Debit exceeds available balance.');
      return;
    }

    setSubmitting(true);
    try {
      await upsertBankBalance({
        bank_name: bank.bank_name,
        balance_date: todayISO(),
        available_balance: newBalance
      });
      queryClient.invalidateQueries({ queryKey: ['acctBankBalances'] });
      queryClient.invalidateQueries({ queryKey: ['acctBankLedger'] });
      closeAdjuster();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to adjust balance.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="glass-panel p-5 rounded-3xl border border-white/5 hover:border-white/10 transition-all duration-300 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-extrabold text-slate-100">{bank.bank_name}</h3>
          <span className="text-[10px] font-mono text-slate-400">
            {bank.account_number || <span className="text-red-400/80 font-sans italic">A/C not set</span>}
          </span>
        </div>
        <span className="text-[9px] uppercase font-bold tracking-widest text-slate-500 shrink-0">
          {bank.balance_date}
        </span>
      </div>

      <div>
        <span className="text-[9px] uppercase tracking-widest text-slate-400 font-bold block">Available Balance</span>
        <span className="text-2xl font-black text-amber-500 font-mono block mt-1">{formatCurrency(bank.available_balance)}</span>
        <span className="text-[9px] text-slate-500 font-mono mt-1 block">
          Updated {bank.updated_at ? new Date(bank.updated_at).toLocaleString('en-IN') : '—'}
        </span>
      </div>

      {!readOnly && (
        !adjusting ? (
          <Button variant="glass" size="sm" onClick={() => setAdjusting(true)}>
            Debit / Credit
          </Button>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3 pt-3 border-t border-white/5">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDirection('credit')}
                className={`py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition ${
                  direction === 'credit'
                    ? 'bg-emerald-500 text-slate-950'
                    : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10'
                }`}
              >
                + Credit
              </button>
              <button
                type="button"
                onClick={() => setDirection('debit')}
                className={`py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition ${
                  direction === 'debit'
                    ? 'bg-rose-500 text-slate-950'
                    : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10'
                }`}
              >
                - Debit
              </button>
            </div>

            <FormattedCurrencyInput
              placeholder="Amount"
              value={amount}
              onValueChange={setAmount}
            />

            {error && <p className="text-[10px] font-semibold text-red-400">{error}</p>}

            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="glass" size="sm" onClick={closeAdjuster} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm" loading={submitting}>
                Confirm
              </Button>
            </div>
          </form>
        )
      )}
    </div>
  );
};

export default BankCard;
