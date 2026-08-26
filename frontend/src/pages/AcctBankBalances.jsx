import { useState } from 'react';
import { useAuth } from '../components/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { Button, Modal } from '../components/ui';

import BankBalanceEditor from '../components/acctRequisition/BankBalanceEditor';
import BankCard from '../components/acctRequisition/BankCard';
import BankLedgerPanel from '../components/acctRequisition/BankLedgerPanel';
import { getBankBalances } from '../api/acctRequisitionsApi';

const AcctBankBalances = () => {
  const { user } = useAuth();
  const canAccess = ['accounts', 'ho', 'admin'].includes(user?.role);
  const canEdit = ['accounts', 'admin'].includes(user?.role);
  const [showAddBank, setShowAddBank] = useState(false);

  const { data: bankBalances = [], isLoading } = useQuery({
    queryKey: ['acctBankBalances'],
    queryFn: async () => (await getBankBalances()).data?.bankBalances ?? [],
    staleTime: 60 * 1000
  });

  if (!canAccess) {
    return <div className="p-8 text-center text-slate-400 text-sm">Access denied.</div>;
  }

  return (
    <>
      <div className="mb-8 pb-6 border-b border-white/5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">
            Accounts Department · HO Approval
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Bank Balance Master</h1>
          <p className="text-xs text-slate-400 font-medium mt-1.5">
            {canEdit
              ? 'Manually-maintained reference table — debit/credit an existing account or add a new bank.'
              : 'Reference table of active company bank accounts and current available balances.'}
          </p>
        </div>
        {canEdit && <Button onClick={() => setShowAddBank(true)}>+ Add Bank</Button>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2">
          {isLoading ? (
            <div className="py-12 text-center text-xs text-slate-500">Loading balances...</div>
          ) : bankBalances.length === 0 ? (
            <div className="glass-panel rounded-3xl p-8 text-center text-slate-500 text-xs font-bold uppercase tracking-wider">
              {canEdit ? 'No bank accounts set up yet. Use "+ Add Bank" to create one.' : 'No bank accounts set up yet.'}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {bankBalances.map((b) => (
                <BankCard key={b.bank_name} bank={b} readOnly={!canEdit} />
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-1">
          <BankLedgerPanel />
        </div>
      </div>

      <Modal
        isOpen={showAddBank}
        onClose={() => setShowAddBank(false)}
        title="Add / Reconcile Bank"
        size="sm"
      >
        <BankBalanceEditor bankBalances={bankBalances} onSaved={() => setShowAddBank(false)} />
      </Modal>
    </>
  );
};

export default AcctBankBalances;
