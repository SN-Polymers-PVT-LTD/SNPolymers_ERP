import { useAuth } from '../components/AuthContext';
import { useQuery } from '@tanstack/react-query';

import BankBalanceEditor from '../components/acctRequisition/BankBalanceEditor';
import { getBankBalances } from '../api/acctRequisitionsApi';

const formatCurrency = (val) =>
  val != null ? `₹ ${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—';

const AcctBankBalances = () => {
  const { user } = useAuth();
  const isAccountsUser = user?.role === 'accounts' || user?.role === 'admin';

  const { data: bankBalances = [], isLoading } = useQuery({
    queryKey: ['acctBankBalances'],
    queryFn: async () => (await getBankBalances()).data?.bankBalances ?? [],
    staleTime: 60 * 1000
  });

  if (!isAccountsUser) {
    return <div className="p-8 text-center text-slate-400 text-sm">Access denied.</div>;
  }

  return (
    <>
      <div className="mb-8 pb-6 border-b border-white/5">
        <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">
          Accounts Department · HO Approval
        </span>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Bank Balance Master</h1>
        <p className="text-xs text-slate-400 font-medium mt-1.5">
          Manually-maintained reference table — reconcile a bank's balance against a statement, or add a new bank account.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-1">
          <BankBalanceEditor bankBalances={bankBalances} />
        </div>

        <div className="lg:col-span-2 glass-panel rounded-3xl overflow-hidden shadow-xl border border-white/5">
          {isLoading ? (
            <div className="py-12 text-center text-xs text-slate-500">Loading balances...</div>
          ) : bankBalances.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs font-bold uppercase tracking-wider">
              No bank accounts set up yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/5 text-[9px] uppercase font-bold tracking-widest text-slate-400 bg-white/[0.02]">
                    <th className="px-6 py-4">Bank</th>
                    <th className="px-6 py-4">Available Balance</th>
                    <th className="px-6 py-4">Date of Balance</th>
                    <th className="px-6 py-4">Last Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-xs font-semibold text-slate-300">
                  {bankBalances.map((b) => (
                    <tr key={b.bank_name} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-6 py-4 text-slate-100 font-bold">{b.bank_name}</td>
                      <td className="px-6 py-4 text-amber-500 font-extrabold font-mono">{formatCurrency(b.available_balance)}</td>
                      <td className="px-6 py-4 text-slate-400 font-mono">{b.balance_date}</td>
                      <td className="px-6 py-4 text-[10px] text-slate-500 font-normal">
                        {b.updated_at ? new Date(b.updated_at).toLocaleString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default AcctBankBalances;
