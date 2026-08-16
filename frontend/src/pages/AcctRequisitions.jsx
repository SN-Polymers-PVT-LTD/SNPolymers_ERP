import { useState } from 'react';
import { useAuth } from '../components/AuthContext';
import { Button, Modal, SkeletonPage } from '../components/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import SheetCard from '../components/acctRequisition/SheetCard';
import LineItemRow from '../components/acctRequisition/LineItemRow';
import BankBalanceBanner from '../components/acctRequisition/BankBalanceBanner';
import BulkNeftExportButton from '../components/acctRequisition/BulkNeftExportButton';

import {
  getSheets, getSheetById, createSheet, submitSheet,
  addLineItem, updateLineItem, deleteLineItem, resubmitLineItem,
  getBankBalances
} from '../api/acctRequisitionsApi';

const AcctRequisitions = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedSheetId, setSelectedSheetId] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedItemIds, setSelectedItemIds] = useState([]);

  const isAccountsUser = user?.role === 'accounts' || user?.role === 'admin';

  const { data: sheets = [], isLoading: loadingSheets } = useQuery({
    queryKey: ['acctSheets'],
    queryFn: async () => (await getSheets()).data?.sheets ?? [],
    staleTime: 15 * 1000
  });

  const { data: sheetDetail, isLoading: loadingDetail } = useQuery({
    queryKey: ['acctSheet', selectedSheetId],
    queryFn: async () => (await getSheetById(selectedSheetId)).data?.sheet,
    enabled: !!selectedSheetId
  });

  const { data: bankBalances = [] } = useQuery({
    queryKey: ['acctBankBalances'],
    queryFn: async () => (await getBankBalances()).data?.bankBalances ?? [],
    staleTime: 60 * 1000
  });

  const invalidateSheet = () => {
    queryClient.invalidateQueries({ queryKey: ['acctSheets'] });
    queryClient.invalidateQueries({ queryKey: ['acctSheet', selectedSheetId] });
  };

  const handleCreateSheet = async () => {
    setError('');
    try {
      const res = await createSheet({});
      setSuccess(`Sheet ${res.data.sheet.sheet_number} created.`);
      queryClient.invalidateQueries({ queryKey: ['acctSheets'] });
      setSelectedSheetId(res.data.sheet.id);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create sheet.');
    }
  };

  const handleAddItem = async () => {
    setError('');
    try {
      await addLineItem(selectedSheetId, {});
      invalidateSheet();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to add line item.');
    }
  };

  const handleSaveItem = async (itemId, payload) => {
    await updateLineItem(selectedSheetId, itemId, payload);
    invalidateSheet();
  };

  const handleResubmitItem = async (itemId, payload) => {
    await resubmitLineItem(itemId, payload);
    invalidateSheet();
    setSuccess('Line item resubmitted for HO review.');
  };

  const handleDeleteItem = async (itemId) => {
    setError('');
    try {
      await deleteLineItem(selectedSheetId, itemId);
      invalidateSheet();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete line item.');
    }
  };

  const handleSubmitSheet = async () => {
    setError('');
    try {
      await submitSheet(selectedSheetId);
      setSuccess('Sheet submitted for HO review.');
      invalidateSheet();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to submit sheet.');
    }
  };

  const toggleSelectItem = (itemId, checked) => {
    setSelectedItemIds(prev => checked ? [...prev, itemId] : prev.filter(id => id !== itemId));
  };

  if (!isAccountsUser) {
    return <div className="p-8 text-center text-slate-400 text-sm">Access denied.</div>;
  }

  const items = sheetDetail?.items || [];
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
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Requisition Sheets</h1>
        </div>
        <Button onClick={handleCreateSheet}>New Sheet</Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-1 flex flex-col gap-3">
          {loadingSheets ? (
            <SkeletonPage />
          ) : sheets.length === 0 ? (
            <p className="text-xs text-slate-500 text-center p-8">No requisition sheets yet.</p>
          ) : (
            sheets.map(sheet => (
              <SheetCard
                key={sheet.id}
                sheet={sheet}
                selected={sheet.id === selectedSheetId}
                onClick={(s) => setSelectedSheetId(s.id)}
              />
            ))
          )}
        </div>

        <div className="lg:col-span-2 flex flex-col gap-4">
          {!selectedSheetId ? (
            <p className="text-xs text-slate-500 text-center p-12">Select a sheet to view its line items.</p>
          ) : loadingDetail ? (
            <SkeletonPage />
          ) : (
            <>
              {primaryBank && <BankBalanceBanner bankBalance={primaryBank} lineItems={items} />}

              {sheetDetail.sheet_status === 'Open' && (
                <Button variant="glass" size="sm" onClick={handleAddItem} className="self-start">
                  + Add Line Item
                </Button>
              )}

              <div className="flex flex-col gap-3">
                {items.map(item => (
                  <LineItemRow
                    key={item.id}
                    item={item}
                    sheetStatus={sheetDetail.sheet_status}
                    bankBalances={bankBalances}
                    onSave={handleSaveItem}
                    onResubmit={handleResubmitItem}
                    onDelete={handleDeleteItem}
                    selectable={sheetDetail.sheet_status === 'Submitted' && item.payment_mode === 'Bulk NEFT'}
                    selected={selectedItemIds.includes(item.id)}
                    onToggleSelect={toggleSelectItem}
                  />
                ))}
              </div>

              {sheetDetail.sheet_status === 'Open' && items.length > 0 && (
                <Button variant="amber" onClick={handleSubmitSheet} className="self-start">
                  Submit Sheet
                </Button>
              )}

              {sheetDetail.sheet_status === 'Submitted' && eligibleNeftItemIds.length > 0 && (
                <BulkNeftExportButton
                  sheetId={selectedSheetId}
                  selectedItemIds={selectedItemIds}
                  onExported={() => setSelectedItemIds([])}
                />
              )}
            </>
          )}
        </div>
      </div>

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

export default AcctRequisitions;
