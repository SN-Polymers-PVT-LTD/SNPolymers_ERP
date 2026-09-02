import { useState, useRef, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../components/AuthContext';
import { Button, SkeletonPage, Badge, Table, TableHeader, TableBody, TableRow, TableCell, Pagination, SuccessPopup, ErrorPopup, PremiumSuccessModal } from '../components/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import LineItemRow from '../components/acctRequisition/LineItemRow';
import BankBalanceBanner from '../components/acctRequisition/BankBalanceBanner';
import BulkNeftExportButton from '../components/acctRequisition/BulkNeftExportButton';
import ImportEligibleItemsModal from '../components/acctRequisition/ImportEligibleItemsModal';
import CreditLedgerImportModal from '../components/acctRequisition/CreditLedgerImportModal';
import ExportCsvStatusModal from '../components/acctRequisition/ExportCsvStatusModal';

import {
  getSheetById, submitSheet,
  addLineItem, updateLineItem, deleteLineItem, resubmitLineItem,
  getBankBalances, getAccountSubTitles, upsertAccountSubTitle, getIndianBanks,
  getParticulars, upsertParticular, deleteSheetIfEmpty
} from '../api/acctRequisitionsApi';
import { getProjects } from '../api/projectsApi';
import { buildSheetCsv } from '../utils/acctSheetCsv';

const ITEMS_PER_PAGE = 20;

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
  const [premiumSuccess, setPremiumSuccess] = useState(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [submittingSheet, setSubmittingSheet] = useState(false);
  const [addingItem, setAddingItem] = useState(false);
  const [deletingItemId, setDeletingItemId] = useState(null);
  const [page, setPage] = useState(1);
  const [focusItemId, setFocusItemId] = useState(null);
  const [showRejected, setShowRejected] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showCreditImportModal, setShowCreditImportModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const saveFnsRef = useRef({});

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

  // Best-effort cleanup for a sheet that's abandoned while still empty —
  // never had a single item added, or had every item added then deleted.
  // Deliberately not hooked into deleting an item directly: that would nuke
  // the sheet mid-edit if the user deletes a wrong row and immediately adds
  // a replacement, which is normal editing, not abandonment. Firing this on
  // unmount (leaving the page) is the point where "empty" actually means
  // "done with this sheet." Reads from a ref (not `sheetDetail` directly) so
  // the cleanup effect can stay declared before the early loading/not-found
  // returns below, as the Rules of Hooks require.
  const emptySheetCleanupRef = useRef({ id, status: null, itemCount: 0 });
  useEffect(() => {
    emptySheetCleanupRef.current = {
      id,
      status: sheetDetail?.sheet_status,
      itemCount: sheetDetail?.items?.length ?? 0
    };
  });
  useEffect(() => {
    return () => {
      const { id: sid, status, itemCount } = emptySheetCleanupRef.current;
      if (status === 'Open' && itemCount === 0) {
        deleteSheetIfEmpty(sid)
          .then((res) => {
            if (!res.data?.deleted) return;
            // Without this, the sheet list page's cached query never learns
            // this sheet is gone — if it's already mounted (e.g. the user
            // navigates straight back to it), the deleted sheet keeps
            // showing as a live row until some unrelated refetch happens,
            // and clicking its own Discard button then fails confusingly
            // (the sheet is already gone, not "no longer empty").
            queryClient.invalidateQueries({ queryKey: ['acctSheets'] });
            // If this sheet had received an imported item that was later
            // removed again before submit, deleting it restores that
            // item's eligibility (039_delete_empty_sheet_restores_imports.sql)
            // — the Held/Rejected list needs to know, or it'll keep
            // showing stale data missing the just-restored item.
            if (res.data?.restoredImportCount > 0) {
              queryClient.invalidateQueries({ queryKey: ['acctImportEligibleItems'] });
            }
          })
          .catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const { data: particularsRaw = [] } = useQuery({
    queryKey: ['acctParticulars'],
    queryFn: async () => (await getParticulars()).data?.particulars ?? [],
    staleTime: 60 * 1000,
    enabled: isAccountsUser
  });
  const particulars = particularsRaw.filter(p => p.is_active);

  const { data: projectsRaw = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => (await getProjects()).data?.projects ?? [],
    staleTime: 120 * 1000,
    enabled: isAccountsUser
  });
  // WO. No. dropdown only offers active work orders — Closed/Complete Under
  // Maintenance ones can't be picked for a new entry (existing line items
  // that already reference one keep displaying it read-only regardless).
  const projects = projectsRaw.filter(p => p.status === 'Running');

  const handleCreateParticular = async (title) => {
    const res = await upsertParticular({ title });
    queryClient.invalidateQueries({ queryKey: ['acctParticulars'] });
    return res.data.particular;
  };

  const invalidateSheet = () => {
    queryClient.invalidateQueries({ queryKey: ['acctSheets'] });
    queryClient.invalidateQueries({ queryKey: ['acctSheet', id] });
  };

  // Forces the sheet list to refetch fresh the moment this navigation
  // actually happens, rather than only relying on the unmount cleanup
  // effect's own (async, delete-dependent) invalidation below — that one
  // still fires and invalidates again once an auto-delete actually
  // completes, but this makes the common case (nothing to clean up, or the
  // cleanup finishes quickly) show an up-to-date list immediately instead
  // of whatever was last cached.
  const handleBackToSheets = () => {
    queryClient.invalidateQueries({ queryKey: ['acctSheets'] });
    navigate('/acct-requisitions');
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
    // Reads the cache directly (after the patch above, so it already
    // includes the new placeholder) rather than closing over the
    // render-scope `visibleItems` — the Ctrl+Alt+N handler below is
    // captured once by an effect that only re-runs on sheet_status/id
    // changes, so a render-scope value here would freeze at whatever it was
    // on that render and go stale for the rest of the editing session (every
    // keyboard-triggered add would jump to the same wrong page instead of
    // the current last page).
    const cachedItems = (queryClient.getQueryData(['acctSheet', id])?.items || []);
    const visibleCountAfterAdd = cachedItems.filter(i => i.requisition_status !== 'Rejected').length;
    setPage(Math.max(Math.ceil(visibleCountAfterAdd / ITEMS_PER_PAGE), 1));
    try {
      const res = await addLineItem(id, {});
      const newItem = res.data?.item;
      patchItems((items) => items.map((i) => (i.id === tempId ? newItem : i)));
      setFocusItemId(newItem.id);
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

  // Batch-saves every currently-editable (openPath) row — each row registered
  // its own save function via `registerSave` while mounted. Shared by the
  // "Save Draft" button and by Submit Sheet (which needs every row actually
  // persisted first: submit_acct_sheet_transact validates the DB rows, not
  // whatever's still sitting unsaved in a row's local input state).
  const saveAllRows = async () => {
    const saveFns = Object.values(saveFnsRef.current);
    if (saveFns.length === 0) return { total: 0, failureCount: 0 };
    const results = await Promise.allSettled(saveFns.map((fn) => fn()));
    const failureCount = results.filter((r) => r.status === 'rejected').length;
    invalidateSheet();
    return { total: saveFns.length, failureCount };
  };

  // Row-level errors already surface inline (LineItemRow sets its own error
  // state); this only summarizes how many rows failed so the user knows to
  // scroll and check, without duplicating per-row error text here.
  const handleSaveDraft = async () => {
    setError('');
    setSuccess('');
    setSavingDraft(true);
    try {
      const { total, failureCount } = await saveAllRows();
      if (total === 0) return;
      if (failureCount > 0) {
        setError(`${failureCount} of ${total} line item(s) failed to save. Check the errors below.`);
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
    setSuccess('');
    setSubmittingSheet(true);
    try {
      // Persist every row's unsaved edits first — submitSheet validates the
      // DB rows, not whatever's still sitting in a row's local input state,
      // so submitting without this first would fail for any row the user
      // hadn't explicitly clicked Save Draft on.
      const { failureCount } = await saveAllRows();
      if (failureCount > 0) {
        setError(`${failureCount} line item(s) failed to save — fix the errors below, then Submit Sheet again.`);
        return;
      }

      await submitSheet(id);
      setPremiumSuccess({
        title: 'Sheet Submitted',
        message: 'This sheet has been sent to HO for review.',
        details: [
          { label: 'Req. No.', value: sheetDetail.sheet_number },
          { label: 'New Status', value: 'Submitted', pill: true }
        ]
      });
      invalidateSheet();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to submit sheet.');
    } finally {
      setSubmittingSheet(false);
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
  // Rejected items are terminal (see act_acct_line_item_non_approve_transact)
  // and only ever come back via HO's separate Reopen action — keeping them
  // in the main paginated table just adds noise for Accounts, who can't act
  // on them anyway. They're still in `items` for CSV export/bank projections;
  // just excluded from the main table and tucked into a collapsed section.
  const visibleItems = items.filter(i => i.requisition_status !== 'Rejected');
  const rejectedItems = items.filter(i => i.requisition_status === 'Rejected');
  // Accounts can only ever act on a draft (status null, sheet still Open —
  // edit/delete) or a Returned-for-Correction item (fix + resubmit). Every
  // other status — Pending HO Review (nothing to do but wait), On Hold
  // (terminal, 037_terminal_hold_and_rejected.sql — only re-import moves it
  // forward), Approved/Partially Approved — has nothing left for Accounts
  // to do here, so they share one read-only table with no Actions column
  // instead of an Actions cell that was empty for most of them anyway.
  const actionableItems = visibleItems.filter(i => i.requisition_status === null || i.requisition_status === 'Returned for Correction');
  const otherItems = visibleItems.filter(i => i.requisition_status !== null && i.requisition_status !== 'Returned for Correction');
  const totalPages = Math.max(Math.ceil(actionableItems.length / ITEMS_PER_PAGE), 1);
  const pagedItems = actionableItems.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);
  const eligibleNeftItems = items
    .filter(i => i.payment_mode === 'Bulk NEFT' && ['Approved', 'Partially Approved'].includes(i.requisition_status))
    .map(i => ({ id: i.id, debit_bank_ac_type: i.debit_bank_ac_type }));

  const handleExportCsv = (status) => {
    const exportItems = status === 'All' ? items : items.filter(i => i.requisition_status === status);
    const csv = buildSheetCsv(sheetDetail, exportItems);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${sheetDetail.sheet_number}${status === 'All' ? '' : `-${status.replace(/\s+/g, '-')}`}.csv`;
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
          <p className="text-xs text-slate-400 font-medium mt-1.5">Add, edit, and submit requisition line items for HO review.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="glass" size="sm" onClick={handleBackToSheets}>
            ← Back to Sheets
          </Button>
          <Button variant="glass" size="sm" onClick={() => navigate('/acct-requisitions/bank-balances')}>
            Manage Bank Balances
          </Button>
        </div>
      </div>

      {bankBalances.length > 0 && (
        <div className="glass-panel p-5 rounded-2xl mb-8 border border-white/10 bg-gradient-to-r from-white/[0.02] to-amber-500/[0.02]">
          <div className="flex flex-wrap gap-4">
            {bankBalances.filter(b => !b.is_virtual).map((bank) => (
              <BankBalanceBanner key={bank.bank_name} bankBalance={bank} lineItems={items} />
            ))}
          </div>
        </div>
      )}

      {actionableItems.length === 0 && otherItems.length === 0 && rejectedItems.length === 0 ? (
        <p className="text-xs text-slate-500 text-center p-12 glass-panel rounded-3xl border border-white/5">No line items on this sheet yet.</p>
      ) : actionableItems.length === 0 && otherItems.length === 0 ? (
        <p className="text-xs text-slate-500 text-center p-12 glass-panel rounded-3xl border border-white/5">All line items on this sheet have been rejected — see below.</p>
      ) : (
        <>
          {actionableItems.length > 0 && (
            <div className="glass-panel rounded-3xl border border-white/5 overflow-hidden">
              <Table containerClassName="min-w-[1150px]">
                <TableHeader>
                  <TableRow hover={false}>
                    <TableCell isHeader>Particulars</TableCell>
                    <TableCell isHeader>Account Sub-title</TableCell>
                    <TableCell isHeader>WO. No.</TableCell>
                    <TableCell isHeader>Beneficiary</TableCell>
                    <TableCell isHeader>Debit Bank</TableCell>
                    <TableCell isHeader>Requested Amount</TableCell>
                    <TableCell isHeader>Payment Mode</TableCell>
                    <TableCell isHeader>Remarks</TableCell>
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
                      particulars={particulars}
                      projects={projects}
                      onCreateParticular={handleCreateParticular}
                      onSave={handleSaveItem}
                      onResubmit={handleResubmitItem}
                      onDelete={handleDeleteItem}
                      deleting={deletingItemId === item.id}
                      onAddItem={handleAddItem}
                      addingItem={addingItem}
                      pending={typeof item.id === 'string' && item.id.startsWith('temp-')}
                      registerSave={registerSave}
                      autoFocusParticulars={item.id === focusItemId}
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
                totalRecords={actionableItems.length}
              />
            </div>
          )}

          {otherItems.length > 0 && (
            <div className="flex flex-col gap-2 mt-6">
              <span className="text-[10px] uppercase font-bold tracking-widest text-slate-500">
                Read-Only
              </span>
              <div className="glass-panel rounded-3xl border border-white/5 overflow-hidden">
                <Table containerClassName="min-w-[1100px]">
                  <TableHeader>
                    <TableRow hover={false}>
                      <TableCell isHeader>Particulars</TableCell>
                      <TableCell isHeader>Account Sub-title</TableCell>
                      <TableCell isHeader>WO. No.</TableCell>
                      <TableCell isHeader>Beneficiary</TableCell>
                      <TableCell isHeader>Debit Bank</TableCell>
                      <TableCell isHeader align="right">Requested Amount</TableCell>
                      <TableCell isHeader align="right">Approved Amount</TableCell>
                      <TableCell isHeader>Payment Mode</TableCell>
                      <TableCell isHeader>Remarks</TableCell>
                      <TableCell isHeader>Status</TableCell>
                      <TableCell isHeader>HO Remarks</TableCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {otherItems.map(item => (
                      <LineItemRow
                        key={item.id}
                        item={item}
                        sheetStatus={sheetDetail.sheet_status}
                        bankBalances={bankBalances}
                        indianBanks={indianBanks}
                        particulars={particulars}
                        showActionsCell={false}
                        showApprovedAmountColumn
                        showHoRemarksColumn
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </>
      )}

      {rejectedItems.length > 0 && (
        <div className="flex flex-col gap-2 mt-6">
          <button
            type="button"
            onClick={() => setShowRejected((v) => !v)}
            className="flex items-center gap-2 text-[10px] uppercase font-bold tracking-widest text-slate-500 hover:text-slate-300 transition-colors w-fit"
          >
            <span className={`transition-transform ${showRejected ? 'rotate-90' : ''}`}>▸</span>
            {rejectedItems.length} Rejected {rejectedItems.length === 1 ? 'item' : 'items'} (click to {showRejected ? 'hide' : 'view'})
          </button>
          {showRejected && (
            <div className="glass-panel rounded-3xl border border-white/5 overflow-hidden">
              <Table containerClassName="min-w-[1100px]">
                <TableHeader>
                  <TableRow hover={false}>
                    <TableCell isHeader>Particulars</TableCell>
                    <TableCell isHeader>Account Sub-title</TableCell>
                    <TableCell isHeader>WO. No.</TableCell>
                    <TableCell isHeader>Beneficiary</TableCell>
                    <TableCell isHeader>Debit Bank</TableCell>
                    <TableCell isHeader align="right">Requested Amount</TableCell>
                    <TableCell isHeader>Payment Mode</TableCell>
                    <TableCell isHeader>Remarks</TableCell>
                    <TableCell isHeader>Status</TableCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rejectedItems.map(item => (
                    <LineItemRow
                      key={item.id}
                      item={item}
                      sheetStatus={sheetDetail.sheet_status}
                      bankBalances={bankBalances}
                      showActionsCell={false}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      <div className="glass-panel p-6 rounded-3xl border border-white/10 flex flex-col sm:flex-row justify-between items-center gap-4 mt-6 mb-4 bg-gradient-to-r from-amber-500/[0.01] to-white/[0.01]">
        <div className="flex items-center gap-2 flex-wrap justify-center sm:justify-start">
          {sheetDetail.sheet_status === 'Open' && (
            <>
              <Button variant="glass" size="sm" onClick={handleAddItem} loading={addingItem} title="Add line item (Ctrl+Alt+N)">
                + Add Line Item
              </Button>
              <Button variant="glass" size="sm" onClick={() => setShowImportModal(true)} title="Import Held / Rejected / Pending Review items">
                Import Held / Rejected
              </Button>
              <Button variant="glass" size="sm" onClick={() => setShowCreditImportModal(true)} title="Pull an installment from an open credit purchase">
                Import from Credit Ledger
              </Button>
              {items.length > 0 && (
                <Button variant="glass" size="sm" onClick={handleSaveDraft} loading={savingDraft}>
                  Save Draft
                </Button>
              )}
            </>
          )}
          {['Submitted', 'Reviewed'].includes(sheetDetail.sheet_status) && (
            <BulkNeftExportButton sheetId={id} items={eligibleNeftItems} />
          )}
          {items.length > 0 && (
            <Button variant="glass" size="sm" onClick={() => setShowExportModal(true)}>
              Export to CSV
            </Button>
          )}
        </div>
        {sheetDetail.sheet_status === 'Open' && items.length > 0 && (
          <Button variant="amber" onClick={handleSubmitSheet} loading={submittingSheet}>
            Submit Sheet
          </Button>
        )}
      </div>

      <ImportEligibleItemsModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        targetSheetId={id}
        onImported={() => {
          invalidateSheet();
          setSuccess('Line item imported.');
        }}
      />

      <CreditLedgerImportModal
        isOpen={showCreditImportModal}
        onClose={() => setShowCreditImportModal(false)}
        targetSheetId={id}
        onImported={() => {
          invalidateSheet();
          setSuccess('Installment line item created.');
        }}
      />

      <ExportCsvStatusModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        onExport={handleExportCsv}
      />

      <SuccessPopup isOpen={!!success} onClose={() => setSuccess('')} title="Saved" description={success} />
      <ErrorPopup isOpen={!!error} onClose={() => setError('')} title="Action Blocked" description={error} />
      <PremiumSuccessModal
        isOpen={!!premiumSuccess}
        onClose={() => setPremiumSuccess(null)}
        title={premiumSuccess?.title}
        message={premiumSuccess?.message}
        details={premiumSuccess?.details || []}
      />
    </>
  );
};

export default AcctRequisitionSheetView;
