import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../components/AuthContext';
import { Button, SuccessPopup } from '../components/ui';
import EstimatedBillFilters from '../components/estimatedBill/EstimatedBillFilters';
import EstimatedBillStats from '../components/estimatedBill/EstimatedBillStats';
import EstimatedBillTable from '../components/estimatedBill/EstimatedBillTable';
import EstimatedBillEntryModal from '../components/estimatedBill/EstimatedBillEntryModal';
import { useEstimatedBillsUrlState } from '../hooks/useEstimatedBillsUrlState';
import {
  getEstimatedBills,
  getWorkOrderOptions,
  createEstimatedBillEntry
} from '../api/estimatedBillsApi';

export const EstimatedBill = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const isZo = user?.role === 'zo';
  const defaultZone = isZo ? (user?.zone || '') : '';

  const {
    filters,
    setFilters,
    modalState,
    openNewModal,
    closeModal
  } = useEstimatedBillsUrlState(defaultZone);

  // Success popup state
  const [successPopup, setSuccessPopup] = useState({
    isOpen: false,
    title: 'Estimate Saved',
    description: 'Your changes are live in reports and analytics right away — no approval needed.'
  });
  const [saveError, setSaveError] = useState('');

  // Query: Estimated Bills List
  const {
    data: listData,
    isLoading: isListLoading
  } = useQuery({
    queryKey: ['estimated-bills', filters],
    queryFn: async () => {
      const res = await getEstimatedBills(filters);
      return res.data?.data || [];
    }
  });

  // Query: Work Order options for picker
  const { data: workOrdersData } = useQuery({
    queryKey: ['estimated-bill-work-orders'],
    queryFn: async () => {
      const res = await getWorkOrderOptions();
      return res.data?.workOrders || [];
    }
  });

  // Mutation: Insert Save
  const saveMutation = useMutation({
    mutationFn: (payload) => createEstimatedBillEntry(payload),
    onSuccess: (res, variables) => {
      queryClient.invalidateQueries({ queryKey: ['estimated-bills'] });
      queryClient.invalidateQueries({ queryKey: ['estimated-bill-work-orders'] });
      closeModal();
      setSuccessPopup({
        isOpen: true,
        title: 'Estimate Saved',
        description: `Estimate for ${variables.work_order_no} is live in cash-flow forecasts and analytics.`
      });
    },
    onError: (error) => {
      setSaveError(error.response?.data?.message || 'Failed to save estimated bill. Please try again.');
    }
  });

  const handleOpenNewModal = () => {
    setSaveError('');
    openNewModal();
  };

  const handleViewLedgerClick = (woNo) => {
    navigate(`/estimated-bills/ledger/${encodeURIComponent(woNo)}`);
  };

  const handleCloseModal = () => {
    setSaveError('');
    closeModal();
  };

  const handleSaveSubmit = (payload) => {
    setSaveError('');
    saveMutation.mutate(payload);
  };

  return (
    <div className="space-y-6 w-full">
      {/* Top Header & Action */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-amber-500 font-mono block">
            ZO / HO Forecasting Layer
          </span>
          <h1 className="text-3xl font-extrabold text-slate-100 tracking-tight">
            Estimated Bill Module
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-xl">
            Record forward-looking billing estimates per Work Order for cash-flow forecasting. Grouped summaries per Work Order with full history tracking ledgers.
          </p>
        </div>

        <Button
          variant="primary"
          onClick={handleOpenNewModal}
          className="shadow-lg shadow-amber-500/20"
        >
          <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          New Estimate
        </Button>
      </div>


      {/* Statistics Bar (KPI Strip) */}
      <EstimatedBillStats
        data={listData || []}
        isLoading={isListLoading}
      />

      {/* Filter Bar */}
      <EstimatedBillFilters
        filters={filters}
        onFilterChange={setFilters}
        userRole={user?.role}
        workOrders={workOrdersData || []}
      />

      {/* Data Table */}
      <EstimatedBillTable
        data={listData || []}
        isLoading={isListLoading}
        onViewLedgerClick={handleViewLedgerClick}
      />

      {/* Entry / Edit Modal */}
      <EstimatedBillEntryModal
        isOpen={modalState.isOpen}
        onClose={handleCloseModal}
        initialWorkOrderNo={modalState.initialWorkOrderNo}
        workOrderOptions={workOrdersData || []}
        onSave={handleSaveSubmit}
        isSaving={saveMutation.isPending}
        saveError={saveError}
      />

      {/* Success Feedback Popup */}
      <SuccessPopup
        isOpen={successPopup.isOpen}
        title={successPopup.title}
        description={successPopup.description}
        onClose={() => setSuccessPopup(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
};

export default EstimatedBill;
