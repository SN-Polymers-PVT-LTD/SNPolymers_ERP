import { useState, useRef, useCallback } from 'react';
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
  getBankBalances, getAccountSubTitles, upsertAccountSubTitle
} from '../api/acctRequisitionsApi';

const ITEMS_PER_PAGE = 20;

const getStatusBadgeVariant = (status) => {
  switch (status) {
    case 'Open':
      return 'amber';
    case 'Submitted':
      return 'blue';
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
  const [selectedItemIds, setSelectedItemIds] = useState([]);
  const [savingDraft, setSavingDraft] = useState(false);
  const [page, setPage] = useState(1);
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

  const { data: bankBalances = [] } = useQuery({
    queryKey: ['acctBankBalances'],
    queryFn: async () => (await getBankBalances()).data?.bankBalances ?? [],
    staleTime: 60 * 1000,
    enabled: isAccountsUser
  });

  const { data: accountSubTitles = [] } = useQuery({
    queryKey: ['acctAccountSubTitles'],
    queryFn: async () => (await getAccountSubTitles()).data?.accountSubTitles ?? [],
    staleTime: 60 * 1000,
    enabled: isAccountsUser
  });

  const handleCreateAccountSubTitle = async (title) => {
    const res = await upsertAccountSubTitle({ title });
    queryClient.invalidateQueries({ queryKey: ['acctAccountSubTitles'] });
    return res.data.accountSubTitle;
  };

  const invalidateSheet = () => {
    queryClient.invalidateQueries({ queryKey: ['acctSheets'] });
    queryClient.invalidateQueries({ queryKey: ['acctSheet', id] });
  };

  const handleAddItem = async () => {
    setError('');
    try {
      await addLineItem(id, {});
      invalidateSheet();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to add line item.');
    }
  };

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
    try {
      await deleteLineItem(id, itemId);
      invalidateSheet();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete line item.');
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

  const toggleSelectItem = (itemId, checked) => {
    setSelectedItemIds(prev => checked ? [...prev, itemId] : prev.filter(id2 => id2 !== itemId));
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
  const primaryBank = bankBalances.find(b => items.some(i => i.debit_bank_ac_type === b.bank_name)) || bankBalances[0];
  const eligibleNeftItemIds = items
    .filter(i => i.payment_mode === 'Bulk NEFT' && ['Approved', 'Partially Approved'].includes(i.requisition_status))
    .map(i => i.id);

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

      {primaryBank && <BankBalanceBanner bankBalance={primaryBank} lineItems={items} />}

      <div className="flex items-center gap-2 mt-6 mb-4">
        {sheetDetail.sheet_status === 'Open' && (
          <>
            <Button variant="glass" size="sm" onClick={handleAddItem}>
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
        {sheetDetail.sheet_status === 'Submitted' && eligibleNeftItemIds.length > 0 && (
          <BulkNeftExportButton
            sheetId={id}
            selectedItemIds={selectedItemIds}
            onExported={() => setSelectedItemIds([])}
          />
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
                  onCreateAccountSubTitle={handleCreateAccountSubTitle}
                  onSave={handleSaveItem}
                  onResubmit={handleResubmitItem}
                  onDelete={handleDeleteItem}
                  selectable={sheetDetail.sheet_status === 'Submitted' && item.payment_mode === 'Bulk NEFT'}
                  selected={selectedItemIds.includes(item.id)}
                  onToggleSelect={toggleSelectItem}
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

export default AcctRequisitionSheetView;
