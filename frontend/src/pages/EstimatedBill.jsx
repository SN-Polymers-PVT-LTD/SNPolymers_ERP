import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../components/AuthContext';
import { Button, SuccessPopup } from '../components/ui';
import EstimatedBillFilters from '../components/estimatedBill/EstimatedBillFilters';
import EstimatedBillStats from '../components/estimatedBill/EstimatedBillStats';
import EstimatedBillTable from '../components/estimatedBill/EstimatedBillTable';
import EstimatedBillEntryModal from '../components/estimatedBill/EstimatedBillEntryModal';
import {
  getEstimatedBills,
  getWorkOrderOptions,
  saveEstimatedBill
} from '../api/estimatedBillsApi';

export const EstimatedBill = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const isZo = user?.role === 'zo';

  // Filters state
  const [filters, setFilters] = useState({
    zone: isZo ? (user?.zone || '') : '',
    work_order_no: '',
    status: '',
    min_surety: '',
    payment_date_from: '',
    payment_date_to: ''
  });

  // Modal states
  const [modalState, setModalState] = useState({
    isOpen: false,
    initialWorkOrderNo: null
  });

  // Success popup state
  const [successPopup, setSuccessPopup] = useState({
    isOpen: false,
    title: 'Estimate Saved',
    description: 'Your changes are live in reports and analytics right away — no approval needed.'
  });

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

  // Mutation: Upsert Save
  const saveMutation = useMutation({
    mutationFn: (payload) => saveEstimatedBill(payload),
    onSuccess: (res, variables) => {
      queryClient.invalidateQueries(['estimated-bills']);
      queryClient.invalidateQueries(['estimated-bill-work-orders']);
      setModalState({ isOpen: false, initialWorkOrderNo: null });
      setSuccessPopup({
        isOpen: true,
        title: 'Estimate Saved',
        description: `Estimate for ${variables.work_order_no} is live in cash-flow forecasts and analytics.`
      });
    }
  });

  const handleOpenNewModal = () => {
    setModalState({ isOpen: true, initialWorkOrderNo: null });
  };

  const handleEditClick = (woNo) => {
    setModalState({ isOpen: true, initialWorkOrderNo: woNo });
  };

  const handleCloseModal = () => {
    setModalState({ isOpen: false, initialWorkOrderNo: null });
  };

  const handleSaveSubmit = (payload) => {
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
            Record forward-looking billing estimates per Work Order for cash-flow forecasting. One record per Work Order — updates in place automatically on every save.
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

      {/* ZO Role Context Note Banner */}
      {isZo && (
        <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/25 flex items-center gap-3 text-amber-400 text-xs font-bold">
          <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>
            Viewing as Zonal Office — showing assigned Work Orders only. You can create and edit estimates for Work Orders within your zone.
          </span>
        </div>
      )}

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
        onEditClick={handleEditClick}
      />

      {/* Entry / Edit Modal */}
      <EstimatedBillEntryModal
        isOpen={modalState.isOpen}
        onClose={handleCloseModal}
        initialWorkOrderNo={modalState.initialWorkOrderNo}
        workOrderOptions={workOrdersData || []}
        onSave={handleSaveSubmit}
        isSaving={saveMutation.isPending}
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
