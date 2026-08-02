import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Select, Input, TextArea, Button } from '../ui';
import { useAuth } from '../AuthContext';
import { getEstimatedBillByWO } from '../../api/estimatedBillsApi';

export const EstimatedBillEntryModal = ({
  isOpen = false,
  onClose,
  initialWorkOrderNo = null,
  workOrderOptions = [],
  onSave,
  isSaving = false
}) => {
  const { user } = useAuth();

  const [selectedWoNo, setSelectedWoNo] = useState('');
  const [selectedWoData, setSelectedWoData] = useState(null);

  const [amount, setAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState('');
  const [suretyPct, setSuretyPct] = useState(80);
  const [remarks, setRemarks] = useState('');

  const [lastUpdatedMeta, setLastUpdatedMeta] = useState('');
  const [validationError, setValidationError] = useState('');
  const [isFetchingWO, setIsFetchingWO] = useState(false);

  const resetForm = useCallback(() => {
    setSelectedWoNo('');
    setSelectedWoData(null);
    setAmount('');
    setPaymentDate('');
    setSuretyPct(80);
    setRemarks('');
    setLastUpdatedMeta('Not yet saved');
    setValidationError('');
  }, []);

  const handleWoSelection = useCallback(async (woNo) => {
    if (!woNo) {
      resetForm();
      return;
    }

    const woMatch = workOrderOptions.find(w => w.work_order_no === woNo);
    setSelectedWoData(woMatch || null);
    setSelectedWoNo(woNo);
    setValidationError('');

    // Fetch existing estimate record if any
    setIsFetchingWO(true);
    try {
      const res = await getEstimatedBillByWO(woNo);
      if (!isOpen) return;
      if (res.data?.success && res.data?.data) {
        const r = res.data.data;
        setAmount(r.estimated_bill_amount || '');
        setPaymentDate(r.estimated_payment_date || '');
        setSuretyPct(r.surety_pct ?? 80);
        setRemarks(r.remarks || '');
        const updateDate = r.updated_at
          ? new Date(r.updated_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
          : 'Today';
        setLastUpdatedMeta(`Last updated by ${r.updated_by_name || r.updated_by}, ${updateDate}`);
      } else {
        setAmount('');
        setPaymentDate('');
        setSuretyPct(80);
        setRemarks('');
        setLastUpdatedMeta('Not yet saved');
      }
    } catch {
      if (!isOpen) return;
      // 404 means no record existing yet
      setAmount('');
      setPaymentDate('');
      setSuretyPct(80);
      setRemarks('');
      setLastUpdatedMeta('Not yet saved');
    } finally {
      if (isOpen) {
        setIsFetchingWO(false);
      }
    }
  }, [isOpen, workOrderOptions, resetForm]);

  // Sync initialWorkOrderNo when modal opens
  useEffect(() => {
    if (isOpen) {
      setValidationError('');
      if (initialWorkOrderNo) {
        setSelectedWoNo(initialWorkOrderNo);
        handleWoSelection(initialWorkOrderNo);
      } else {
        resetForm();
      }
    }
  }, [isOpen, initialWorkOrderNo, handleWoSelection, resetForm]);

  const handleSuretyInput = (val) => {
    const num = parseInt(val, 10);
    if (isNaN(num)) {
      setSuretyPct('');
      return;
    }
    const clamped = Math.max(0, Math.min(100, num));
    setSuretyPct(clamped);
  };

  const handleAmountChange = (val) => {
    setAmount(val);
    setValidationError('');
    if (selectedWoData?.work_order_value && Number(val) > Number(selectedWoData.work_order_value)) {
      setValidationError(`Estimated amount cannot exceed Work Order Value (₹${selectedWoData.work_order_value.toLocaleString('en-IN')})`);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!selectedWoNo) {
      setValidationError('Please select a Work Order.');
      return;
    }
    const numAmt = Number(amount);
    if (!amount || isNaN(numAmt) || numAmt <= 0) {
      setValidationError('Please enter a valid positive estimated bill amount.');
      return;
    }
    if (selectedWoData?.work_order_value && numAmt > Number(selectedWoData.work_order_value)) {
      setValidationError(`Estimated bill amount cannot exceed Work Order Value (₹${selectedWoData.work_order_value.toLocaleString('en-IN')}).`);
      return;
    }
    if (!paymentDate) {
      setValidationError('Please select an estimated payment date.');
      return;
    }

    const payload = {
      work_order_no: selectedWoNo,
      estimated_bill_amount: numAmt,
      estimated_payment_date: paymentDate,
      surety_pct: Number(suretyPct || 0),
      remarks: remarks || null
    };

    onSave(payload);
  };

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(val || 0);
  };

  const woSelectOptions = [
    { value: '', label: 'Select a Work Order...' },
    ...workOrderOptions.map(w => ({
      value: w.work_order_no,
      label: `${w.work_order_no} — ${w.site_details || w.department}`
    }))
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      title="Estimated Bill Entry"
      subtitle="Cash-Flow Forecast Layer"
      footer={
        <div className="w-full flex justify-between items-center">
          <span className="text-xs text-slate-400">
            {lastUpdatedMeta}
          </span>
          <div className="flex gap-3 items-center">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="p-2.5 rounded-xl text-rose-500 hover:text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 transition-all duration-200 disabled:opacity-50 flex items-center justify-center"
              title="Cancel"
              aria-label="Cancel"
            >
              <svg className="w-5 h-5 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <Button variant="amber" onClick={handleSubmit} disabled={isSaving || isFetchingWO || Boolean(validationError)}>
              {isSaving ? 'Saving...' : 'Save Estimate'}
            </Button>
          </div>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Work Order Picker */}
        <div>
          <label className="block text-xs font-bold text-slate-300 mb-1.5">
            Work Order <span className="text-amber-500">*</span>
          </label>
          <Select
            value={selectedWoNo}
            onChange={(e) => handleWoSelection(e.target.value)}
            options={woSelectOptions}
            disabled={isFetchingWO}
          />
        </div>

        {/* Master Data Autofill Block */}
        {selectedWoData ? (
          <div className="glass-panel p-4 rounded-xl border border-white/10 bg-white/5 space-y-3">
            <div className="text-[10px] font-extrabold uppercase tracking-widest text-amber-500 font-mono">
              Auto-filled Master Data
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <span className="text-[10px] text-slate-500 uppercase font-mono block">Acting User</span>
                <span className="font-bold text-slate-200">{user?.display_name || user?.mobile_number || '—'}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 uppercase font-mono block">Entry Date</span>
                <span className="font-bold text-slate-200">{new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 uppercase font-mono block">Work Order Value</span>
                <span className="font-extrabold text-amber-400 font-mono tabular-nums">
                  {formatCurrency(selectedWoData.work_order_value)}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 uppercase font-mono block">Zone</span>
                <span className="font-bold text-slate-200">{selectedWoData.zone || '—'}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 uppercase font-mono block">Department</span>
                <span className="font-bold text-slate-200">{selectedWoData.department || '—'}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 uppercase font-mono block">District / State</span>
                <span className="font-bold text-slate-200">
                  {`${selectedWoData.district || '—'}, ${selectedWoData.state || '—'}`}
                </span>
              </div>
              <div className="col-span-2 sm:col-span-3">
                <span className="text-[10px] text-slate-500 uppercase font-mono block">Site Details</span>
                <span className="font-bold text-slate-200">{selectedWoData.site_details || '—'}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-3 rounded-xl border border-dashed border-white/10 text-center text-xs text-slate-400">
            Select a Work Order above to auto-populate master contract data.
          </div>
        )}

        {/* Amount & Date Fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1.5">
              Estimated Bill Amount (₹) <span className="text-amber-500">*</span>
            </label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => handleAmountChange(e.target.value)}
              placeholder="0.00"
              className="font-mono tabular-nums"
            />
            <span className="text-[10px] text-slate-500 block mt-1">
              Must not exceed Work Order Value ({selectedWoData ? formatCurrency(selectedWoData.work_order_value) : '₹0'})
            </span>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1.5">
              Estimated Payment Date <span className="text-amber-500">*</span>
            </label>
            <Input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
            />
          </div>
        </div>

        {/* Surety Percentage Dual Controls */}
        <div>
          <label className="block text-xs font-bold text-slate-300 mb-1.5">
            % Surety Realization Probability
          </label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="0"
              max="100"
              value={suretyPct === '' ? 0 : suretyPct}
              onChange={(e) => setSuretyPct(Number(e.target.value))}
              className="flex-1 accent-amber-500 h-2 bg-slate-800 rounded-lg cursor-pointer"
            />
            <div className="w-24 flex items-center gap-1">
              <Input
                type="number"
                min="0"
                max="100"
                value={suretyPct}
                onChange={(e) => handleSuretyInput(e.target.value)}
                className="font-mono tabular-nums text-center font-bold"
              />
              <span className="text-xs font-extrabold font-mono text-amber-400 shrink-0">
                %
              </span>
            </div>
          </div>
        </div>

        {/* Remarks */}
        <div>
          <label className="block text-xs font-bold text-slate-300 mb-1.5">
            Remarks / Forecast Notes (Optional)
          </label>
          <TextArea
            rows={2}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Add cash-flow forecast notes..."
          />
        </div>

        {/* Inline Error Message */}
        {validationError && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-bold">
            {validationError}
          </div>
        )}
      </form>
    </Modal>
  );
};

export default EstimatedBillEntryModal;
