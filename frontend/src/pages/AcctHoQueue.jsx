import { useState } from 'react';
import { useAuth } from '../components/AuthContext';
import { Modal, Button, SkeletonPage } from '../components/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import SheetCard from '../components/acctRequisition/SheetCard';
import LineItemRow from '../components/acctRequisition/LineItemRow';
import HoDecisionPanel from '../components/acctRequisition/HoDecisionPanel';
import BankBalanceBanner from '../components/acctRequisition/BankBalanceBanner';

import {
  getSheets, getSheetById, actOnLineItem, reopenLineItem, getBankBalances
} from '../api/acctRequisitionsApi';

const AcctHoQueue = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedSheetId, setSelectedSheetId] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const isHoUser = user?.role === 'ho' || user?.role === 'admin';
  const canReopen = user?.permissions?.['ho.requisition.reopen'] === true;

  const { data: sheets = [], isLoading: loadingSheets } = useQuery({
    queryKey: ['acctSheets', 'submitted'],
    queryFn: async () => (await getSheets({ sheet_status: 'Submitted' })).data?.sheets ?? [],
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
    queryClient.invalidateQueries({ queryKey: ['acctSheets', 'submitted'] });
    queryClient.invalidateQueries({ queryKey: ['acctSheet', selectedSheetId] });
  };

  const handleAct = async (itemId, actionData) => {
    await actOnLineItem(itemId, actionData);
    invalidateSheet();
    setSuccess(`Decision '${actionData.action}' applied.`);
  };

  const handleReopen = async (itemId, data) => {
    await reopenLineItem(itemId, data);
    invalidateSheet();
    setSuccess('Line item reopened for review.');
  };

  if (!isHoUser) {
    return <div className="p-8 text-center text-slate-400 text-sm">Access denied.</div>;
  }

  const items = sheetDetail?.items || [];
  const actionableItems = items.filter(i => ['Pending HO Review', 'On Hold'].includes(i.requisition_status));
  const otherItems = items.filter(i => !['Pending HO Review', 'On Hold'].includes(i.requisition_status));
  const primaryBank = bankBalances.find(b => items.some(i => i.debit_bank_ac_type === b.bank_name)) || bankBalances[0];

  return (
    <>
      <div className="mb-8 pb-6 border-b border-white/5">
        <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">
          HO · Accounts Requisition Review
        </span>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">HO Approval Queue</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-1 flex flex-col gap-3">
          {loadingSheets ? (
            <SkeletonPage />
          ) : sheets.length === 0 ? (
            <p className="text-xs text-slate-500 text-center p-8">No submitted sheets pending review.</p>
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
            <p className="text-xs text-slate-500 text-center p-12">Select a sheet to review its line items.</p>
          ) : loadingDetail ? (
            <SkeletonPage />
          ) : (
            <>
              {primaryBank && <BankBalanceBanner bankBalance={primaryBank} lineItems={items} />}

              <div className="flex flex-col gap-4">
                {actionableItems.map(item => (
                  <div key={item.id} className="flex flex-col gap-2">
                    <LineItemRow item={item} sheetStatus={sheetDetail.sheet_status} bankBalances={bankBalances} />
                    <HoDecisionPanel
                      item={item}
                      onAct={(data) => handleAct(item.id, data)}
                      onReopen={(data) => handleReopen(item.id, data)}
                      canReopen={canReopen}
                    />
                  </div>
                ))}
              </div>

              {otherItems.length > 0 && (
                <div className="flex flex-col gap-2 mt-4 pt-4 border-t border-white/5">
                  <span className="text-[10px] uppercase font-bold tracking-widest text-slate-500">
                    Already Decided
                  </span>
                  {otherItems.map(item => (
                    <div key={item.id} className="flex flex-col gap-2">
                      <LineItemRow item={item} sheetStatus={sheetDetail.sheet_status} bankBalances={bankBalances} />
                      <HoDecisionPanel
                        item={item}
                        onAct={(data) => handleAct(item.id, data)}
                        onReopen={(data) => handleReopen(item.id, data)}
                        canReopen={canReopen}
                      />
                    </div>
                  ))}
                </div>
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

export default AcctHoQueue;
