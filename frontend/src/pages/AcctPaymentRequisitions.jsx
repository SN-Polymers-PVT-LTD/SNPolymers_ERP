import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../components/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { Button, Input, Table, TableHeader, TableBody, TableRow, TableCell } from '../components/ui';
import { getPaymentRequisitions } from '../api/acctRequisitionsApi';

const formatCurrency = (val) =>
  val != null ? `₹ ${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—';

const formatDate = (d) =>
  d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

/**
 * Read-only intake list of Payment Requisitions the ZO has sent to Accounts
 * (payment_destination = 'ACCOUNTS'). This is a distinct source domain from
 * the On Hold/Rejected/Pending Review rollover queue (AcctImportEligibleItems)
 * — routing already creates the Accounts line item the moment it succeeds
 * (route_requisition_to_accounts_transact, Model A), so there's nothing to
 * import here, only traceability back to the originating requisition.
 */
const AcctPaymentRequisitions = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAccountsUser = user?.role === 'accounts' || user?.role === 'admin';

  const [search, setSearch] = useState('');

  const { data, isLoading, error: queryError } = useQuery({
    queryKey: ['acctPaymentRequisitions'],
    queryFn: async () => (await getPaymentRequisitions({ limit: 100 })).data,
    enabled: isAccountsUser
  });

  const items = data?.items || [];
  const displayError = queryError?.response?.data?.message || queryError?.message || '';

  const filtered = search.trim()
    ? items.filter((r) => {
        const term = search.toLowerCase();
        return r.requisition_no?.toLowerCase().includes(term)
          || r.work_order_no?.toLowerCase().includes(term)
          || r.beneficiary_name?.toLowerCase().includes(term);
      })
    : items;

  if (!isAccountsUser) {
    return <div className="p-8 text-center text-slate-400 text-sm">Access denied.</div>;
  }

  return (
    <>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-8 pb-6 border-b border-white/5">
        <div>
          <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">
            Accounts Department · Finance Intake
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Payment Requisitions</h1>
          <p className="text-xs text-slate-400 font-medium mt-1.5">
            Approved requisitions the Zonal Office sent to Accounts. Each one already has its Accounts
            line item — open the sheet to fill in Debit Bank Account, Payment Mode, and Cheque details.
          </p>
        </div>
        <Button variant="glass" size="sm" onClick={() => navigate('/acct-requisitions')}>
          ← Back to Sheets
        </Button>
      </div>

      {displayError && (
        <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 mb-6 flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
          {displayError}
        </div>
      )}

      <div className="glass-panel p-4 rounded-2xl border border-white/5 flex flex-col sm:flex-row gap-4 mb-6">
        <Input
          type="text"
          placeholder="Search requisition no., work order, or beneficiary..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          size="sm"
          containerClassName="sm:w-96"
        />
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-xs text-slate-500">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="glass-panel rounded-3xl p-8 text-center text-slate-500 text-xs font-bold uppercase tracking-wider">
          {search ? 'No requisitions match this search.' : 'No Payment Requisitions have been sent to Accounts yet.'}
        </div>
      ) : (
        <div className="glass-panel rounded-3xl border border-white/5 overflow-hidden">
          <Table containerClassName="min-w-[1150px]">
            <TableHeader>
              <TableRow hover={false}>
                <TableCell isHeader>Req No.</TableCell>
                <TableCell isHeader>Work Order</TableCell>
                <TableCell isHeader>Material Head</TableCell>
                <TableCell isHeader>Particulars</TableCell>
                <TableCell isHeader>Beneficiary</TableCell>
                <TableCell isHeader align="right">Approved Amount</TableCell>
                <TableCell isHeader>Sent By</TableCell>
                <TableCell isHeader>Sent At</TableCell>
                <TableCell isHeader>Actions</TableCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.requisition_id}>
                  <TableCell className="font-mono text-slate-200">{r.requisition_no}</TableCell>
                  <TableCell className="font-mono text-slate-300">{r.work_order_no}</TableCell>
                  <TableCell><span className="text-slate-300">{r.material_main_head}</span></TableCell>
                  <TableCell><span className="text-slate-400 text-xs">{r.expen_head_remarks || '—'}</span></TableCell>
                  <TableCell><span className="text-slate-400 text-xs">{r.beneficiary_name || '—'}</span></TableCell>
                  <TableCell align="right"><span className="font-bold text-slate-200">{formatCurrency(r.approved_amount)}</span></TableCell>
                  <TableCell><span className="text-slate-400 text-xs">{r.accounts_sent_by_name || '—'}</span></TableCell>
                  <TableCell><span className="text-slate-500 text-xs">{formatDate(r.accounts_sent_at)}</span></TableCell>
                  <TableCell>
                    {r.sheet ? (
                      <button
                        type="button"
                        onClick={() => navigate(`/acct-requisitions/sheets/${r.sheet.id}`)}
                        className="text-amber-500 hover:text-amber-400 font-mono text-xs underline-offset-2 hover:underline"
                      >
                        View Sheet {r.sheet.sheet_number}
                      </button>
                    ) : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
};

export default AcctPaymentRequisitions;
