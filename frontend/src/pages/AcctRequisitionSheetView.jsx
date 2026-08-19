import { useState, useRef, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../components/AuthContext';
import { Button, Modal, SkeletonPage, Badge, Table, TableHeader, TableBody, TableRow, TableCell, Pagination } from '../components/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import LineItemRow from '../components/acctRequisition/LineItemRow';
import BankBalanceBanner from '../components/acctRequisition/BankBalanceBanner';
import BulkNeftExportButton from '../components/acctRequisition/BulkNeftExportButton';

import {
  getSheetById, submitSheet,
  addLineItem, updateLineItem, deleteLineItem, resubmitLineItem,
  getBankBalances, getAccountSubTitles, upsertAccountSubTitle, getIndianBanks
} from '../api/acctRequisitionsApi';

const ITEMS_PER_PAGE = 20;

const escapeCsvField = (val) => {
  if (val == null) return '';
  const str = String(val);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

const CSV_COLUMNS = [
  ['Sheet Number', (item, sheet) => sheet.sheet_number],
  ['Particulars', (item) => item.particulars],
  ['Account Sub-title', (item) => item.account_sub_title_text],
  ['Beneficiary Name', (item) => item.beneficiary_name],
  ['Beneficiary A/C No', (item) => item.beneficiary_ac_no],
  ['Beneficiary IFSC', (item) => item.beneficiary_ifsc],
  ['Beneficiary Bank', (item) => item.beneficiary_bank_name],
  ['Debit Bank', (item) => item.debit_bank_ac_type],
  ['Requested Amount', (item) => item.req_amount],
  ['Payment Mode', (item) => item.payment_mode],
  ['Cheque No', (item) => item.cheque_no],
  ['Cheque Date', (item) => item.cheque_date],
  ['Status', (item) => item.requisition_status || 'Draft'],
  ['HO Pass Amount', (item) => item.ho_pass_amount],
  ['HO Remarks', (item) => item.ho_remarks],
  ['Created At', (item) => item.created_at],
  ['Updated At', (item) => item.updated_at],
  ['HO Actioned At', (item) => item.ho_actioned_at]
];

const buildSheetCsv = (sheet, items) => {
  const headerRow = CSV_COLUMNS.map(([label]) => label);
  const dataRows = items.map((item) => CSV_COLUMNS.map(([, getValue]) => getValue(item, sheet)));
  return [headerRow, ...dataRows].map((row) => row.map(escapeCsvField).join(',')).join('\r\n');
};

const getStatusBadgeVariant = (status) => {
  switch (status) {
    case 'Open':
      return 'amber';
    case 'Submitted':
      return 'blue';
    case 'Reviewed':
      return 'emerald';
    default:
      return 'slate';
  }
};

const AcctRequisitionSheetView = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [savingDraft, setSavingDraft] = useState(false);
  const [addingItem, setAddingItem] = useState(false);
  const [deletingItemId, setDeletingItemId] = useState(null);
  const [page, setPage] = useState(1);
  const saveFnsRef = useRef({});

  // BeneficiaryAutofill's "Found beneficiary" prompt is dismissed/confirmed
  // per (account_number, ifsc) key. Without this, that state lived only
  // inside each row's own component instance — so two rows paying the same
  // beneficiary (a common case: one vendor, several charge types) each
  // independently re-prompt for a match you already confirmed on an earlier
  // row in this same sheet. Tracking dismissed keys at the sheet level means
  // confirming or dismissing a beneficiary once covers every row referencing
  // it, for the rest of this sheet-editing session.
  const [dismissedBeneficiaryKeys, setDismissedBeneficiaryKeys] = useState(() => new Set());
  const dismissBeneficiaryKey = useCallback((key) => {
    setDismissedBeneficiaryKeys((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, []);

  const registerSave = useCallback((itemId, fn) => {
    if (fn) {
      saveFnsRef.current[itemId] = fn;
    } else {
      delete saveFnsRef.current[itemId];
    }
  }, []);

  const isAccountsUser = user?.role === 'accounts' || user?.role === 'admin';

  const { data: sheetDetail, isLoading: loadingDetail } = useQuery({
    queryKey: ['acctSheet', id],
    queryFn: async () => (await getSheetById(id)).data?.sheet,
    enabled: !!id && isAccountsUser
  });

  const { data: bankBalances = [] } = useQuery({
    queryKey: ['acctBankBalances'],
    queryFn: async () => (await getBankBalances()).data?.bankBalances ?? [],
    staleTime: 60 * 1000,
    enabled: isAccountsUser
  });

  const { data: accountSubTitlesRaw = [] } = useQuery({
    queryKey: ['acctAccountSubTitles'],
    queryFn: async () => (await getAccountSubTitles()).data?.accountSubTitles ?? [],
    staleTime: 60 * 1000,
    enabled: isAccountsUser
  });
  // getAccountSubTitles now returns inactive rows too (needed by the
  // Sub-titles master page) — the line-item dropdown only offers active ones.
  const accountSubTitles = accountSubTitlesRaw.filter(t => t.is_active);

  const { data: indianBanksRaw = [] } = useQuery({
    queryKey: ['acctIndianBanks'],
    queryFn: async () => (await getIndianBanks()).data?.indianBanks ?? [],
    staleTime: 60 * 1000,
    enabled: isAccountsUser
  });
  const indianBanks = indianBanksRaw.filter(b => b.is_active).map(b => b.bank_name);

  const handleCreateAccountSubTitle = async (title) => {
    const res = await upsertAccountSubTitle({ title });
    queryClient.invalidateQueries({ queryKey: ['acctAccountSubTitles'] });
    return res.data.accountSubTitle;
  };

  const invalidateSheet = () => {
    queryClient.invalidateQueries({ queryKey: ['acctSheets'] });
    queryClient.invalidateQueries({ queryKey: ['acctSheet', id] });
  };

  // Patches the cached sheet's items in place instead of invalidating +
  // refetching the whole sheet — addLineItem/deleteLineItem already tell us
  // exactly what changed, so there's no need for a second GET round trip
  // (and the visible gap that comes with it) just to learn what we already
  // know. The sheet list ('acctSheets', e.g. item counts) still gets
  // invalidated, but that refetch happens off-screen on a different page.
  const patchItems = (updater) => {
    queryClient.setQueryData(['acctSheet', id], (old) => (
      old ? { ...old, items: updater(old.items || []) } : old
    ));
  };

  // Optimistic add: a real create still costs a network round trip (POST +
  // the backend's own sheet-status guard + insert), so the row is rendered
  // immediately as a disabled "Creating…" placeholder rather than waiting on
  // that round trip to show anything. It's reconciled with the real item
  // (real id, actually editable) once the request resolves, or removed if it
  // fails. The temp- prefix is how LineItemRow knows to treat it as pending.
  const handleAddItem = async () => {
    setError('');
    setAddingItem(true);
    const tempId = `temp-${crypto.randomUUID()}`;
    const placeholder = {
      id: tempId,
      particulars: '',
      account_sub_title_id: null,
      account_sub_title_text: '',
      beneficiary_ac_no: '',
      beneficiary_name: '',
      beneficiary_ifsc: '',
      beneficiary_bank_name: '',
      debit_bank_ac_type: '',
      req_amount: null,
      payment_mode: '',
      cheque_no: '',
      cheque_date: '',
      requisition_status: null
    };
    patchItems((items) => [...items, placeholder]);
    try {
      const res = await addLineItem(id, {});
      const newItem = res.data?.item;
      patchItems((items) => items.map((i) => (i.id === tempId ? newItem : i)));
      queryClient.invalidateQueries({ queryKey: ['acctSheets'] });
    } catch (err) {
      patchItems((items) => items.filter((i) => i.id !== tempId));
      setError(err.response?.data?.message || 'Failed to add line item.');
    } finally {
      setAddingItem(false);
    }
  };

  // Ctrl+Alt+N adds a line item without reaching for the mouse — only wired
  // up while the sheet is Open (the only state new items can be added in).
  // Single-modifier combos on 'n' keep colliding with something the browser
  // or OS already owns and can't be overridden via preventDefault: Ctrl/Cmd+N
  // opens a new browser window, Ctrl+Shift+N opens an Incognito window, and
  // plain Alt+N is a common window-manager/menu-mnemonic binding on Linux.
  // Three-way combos like this one are essentially never claimed elsewhere.
  useEffect(() => {
    if (sheetDetail?.sheet_status !== 'Open') return undefined;
    const onKeyDown = (e) => {
      if (e.ctrlKey && e.altKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        handleAddItem();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetDetail?.sheet_status, id]);

  const handleSaveItem = async (itemId, payload) => {
    await updateLineItem(id, itemId, payload);
    invalidateSheet();
  };

  const handleResubmitItem = async (itemId, payload) => {
    await resubmitLineItem(itemId, payload);
    invalidateSheet();
    setSuccess('Line item resubmitted for HO review.');
  };

  // Batch-saves every currently-editable (openPath) row in one click — each
  // row registered its own save function via `registerSave` while mounted.
  // Row-level errors already surface inline (LineItemRow sets its own error
  // state); this only summarizes how many rows failed so the user knows to
  // scroll and check, without duplicating per-row error text here.
  const handleSaveDraft = async () => {
    setError('');
    setSuccess('');
    const saveFns = Object.values(saveFnsRef.current);
    if (saveFns.length === 0) return;

    setSavingDraft(true);
    try {
      const results = await Promise.allSettled(saveFns.map((fn) => fn()));
      const failureCount = results.filter((r) => r.status === 'rejected').length;
      invalidateSheet();
      if (failureCount > 0) {
        setError(`${failureCount} of ${saveFns.length} line item(s) failed to save. Check the errors below.`);
      } else {
        setSuccess('Draft saved.');
      }
    } finally {
      setSavingDraft(false);
    }
  };

  const handleDeleteItem = async (itemId) => {
    setError('');
    setDeletingItemId(itemId);
    try {
      await deleteLineItem(id, itemId);
      patchItems((items) => items.filter((i) => i.id !== itemId));
      queryClient.invalidateQueries({ queryKey: ['acctSheets'] });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete line item.');
    } finally {
      setDeletingItemId(null);
    }
  };

  const handleSubmitSheet = async () => {
    setError('');
    try {
      await submitSheet(id);
      setSuccess('Sheet submitted for HO review.');
      invalidateSheet();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to submit sheet.');
    }
  };

  if (!isAccountsUser) {
    return <div className="p-8 text-center text-slate-400 text-sm">Access denied.</div>;
  }

  if (loadingDetail) {
    return <SkeletonPage />;
  }

  if (!sheetDetail) {
    return (
      <div className="flex-grow flex items-center justify-center p-12 text-xs uppercase font-extrabold tracking-widest text-slate-400">
        Requisition sheet not found.
      </div>
    );
  }

  const items = sheetDetail.items || [];
  const totalPages = Math.max(Math.ceil(items.length / ITEMS_PER_PAGE), 1);
  const pagedItems = items.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);
  const eligibleNeftItems = items
    .filter(i => i.payment_mode === 'Bulk NEFT' && ['Approved', 'Partially Approved'].includes(i.requisition_status))
    .map(i => ({ id: i.id, debit_bank_ac_type: i.debit_bank_ac_type }));

  const handleExportCsv = () => {
    const csv = buildSheetCsv(sheetDetail, items);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${sheetDetail.sheet_number}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-8 pb-6 border-b border-white/5">
        <div>
          <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">
            Accounts Department · HO Approval
          </span>
          <div className="flex items-center gap-3 mt-1">
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-100">{sheetDetail.sheet_number}</h1>
            <Badge variant={getStatusBadgeVariant(sheetDetail.sheet_status)} showDot={false}>
              {sheetDetail.sheet_status}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="glass" size="sm" onClick={() => navigate('/acct-requisitions')}>
            ← Back to Sheets
          </Button>
          <Button variant="glass" size="sm" onClick={() => navigate('/acct-requisitions/bank-balances')}>
            Manage Bank Balances
          </Button>
        </div>
      </div>

      {bankBalances.length > 0 && (
        <div className="flex flex-wrap gap-4">
          {bankBalances.map((bank) => (
            <BankBalanceBanner key={bank.bank_name} bankBalance={bank} lineItems={items} />
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 mt-6 mb-4">
        {sheetDetail.sheet_status === 'Open' && (
          <>
            <Button variant="glass" size="sm" onClick={handleAddItem} loading={addingItem} title="Add line item (Ctrl+Alt+N)">
              + Add Line Item
            </Button>
            {items.length > 0 && (
              <Button variant="glass" size="sm" onClick={handleSaveDraft} loading={savingDraft}>
                Save Draft
              </Button>
            )}
          </>
        )}
        {sheetDetail.sheet_status === 'Open' && items.length > 0 && (
          <Button variant="amber" onClick={handleSubmitSheet}>
            Submit Sheet
          </Button>
        )}
        {['Submitted', 'Reviewed'].includes(sheetDetail.sheet_status) && (
          <BulkNeftExportButton sheetId={id} items={eligibleNeftItems} />
        )}
        {items.length > 0 && (
          <Button variant="glass" size="sm" onClick={handleExportCsv}>
            Export to CSV
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-slate-500 text-center p-12 glass-panel rounded-3xl border border-white/5">No line items on this sheet yet.</p>
      ) : (
        <div className="glass-panel rounded-3xl border border-white/5 overflow-hidden">
          <Table containerClassName="min-w-[1100px]">
            <TableHeader>
              <TableRow hover={false}>
                <TableCell isHeader>Particulars</TableCell>
                <TableCell isHeader>Account Sub-title</TableCell>
                <TableCell isHeader>Beneficiary</TableCell>
                <TableCell isHeader>Debit Bank</TableCell>
                <TableCell isHeader align="right">Requested Amount</TableCell>
                <TableCell isHeader>Payment Mode</TableCell>
                <TableCell isHeader>Status</TableCell>
                <TableCell isHeader>Actions</TableCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedItems.map(item => (
                <LineItemRow
                  key={item.id}
                  item={item}
                  sheetStatus={sheetDetail.sheet_status}
                  bankBalances={bankBalances}
                  accountSubTitles={accountSubTitles}
                  indianBanks={indianBanks}
                  onCreateAccountSubTitle={handleCreateAccountSubTitle}
                  onSave={handleSaveItem}
                  onResubmit={handleResubmitItem}
                  onDelete={handleDeleteItem}
                  deleting={deletingItemId === item.id}
                  onAddItem={handleAddItem}
                  dismissedBeneficiaryKeys={dismissedBeneficiaryKeys}
                  onDismissBeneficiaryKey={dismissBeneficiaryKey}
                  addingItem={addingItem}
                  pending={typeof item.id === 'string' && item.id.startsWith('temp-')}
                  registerSave={registerSave}
                />
              ))}
            </TableBody>
          </Table>
          <Pagination
            currentPage={page}
            totalPages={totalPages}
            onPageChange={setPage}
            maxVisible={5}
            showLabel={true}
            totalRecords={items.length}
          />
        </div>
      )}

      {success && (
        <Modal isOpen={true} onClose={() => setSuccess('')} title="Success" size="sm"
          footer={<Button variant="amber" onClick={() => setSuccess('')} className="w-full">Continue</Button>}>
          <p className="text-xs text-slate-300 text-center py-4">{success}</p>
        </Modal>
      )}

      {error && (
        <Modal isOpen={true} onClose={() => setError('')} title="Action Blocked" size="sm"
          footer={<Button variant="primary" onClick={() => setError('')} className="w-full">Understood</Button>}>
          <p className="text-xs text-slate-300 text-center py-4">{error}</p>
        </Modal>
      )}
    </>
  );
};

export { buildSheetCsv };
export default AcctRequisitionSheetView;
