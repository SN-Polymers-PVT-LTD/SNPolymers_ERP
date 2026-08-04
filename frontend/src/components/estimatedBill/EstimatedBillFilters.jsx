import React from 'react';
import { Select, Input } from '../ui';

export const EstimatedBillFilters = ({
  filters,
  onFilterChange,
  userRole,
  workOrders = []
}) => {
  const isZo = userRole === 'zo';

  const zoneOptions = [
    { value: '', label: 'All Zones' },
    { value: 'North Bengal', label: 'North Bengal' },
    { value: 'South Bengal', label: 'South Bengal' },
    { value: 'Kolkata Zone', label: 'Kolkata Zone' },
    { value: 'Western Zone', label: 'Western Zone' },
    { value: 'Sikkim', label: 'Sikkim' },
    { value: 'Assam', label: 'Assam' },
    { value: 'Odisha', label: 'Odisha' }
  ];

  const woOptions = [
    { value: '', label: 'All Work Orders' },
    ...workOrders.map(w => ({
      value: w.work_order_no,
      label: `${w.work_order_no} — ${w.site_details || w.department}`
    }))
  ];

  const suretyOptions = [
    { value: '', label: 'Any Surety %' },
    { value: '50', label: '50% & above' },
    { value: '75', label: '75% & above' },
    { value: '90', label: '90% & above' }
  ];

  const statusOptions = [
    { value: '', label: 'Running (Active)' },
    { value: 'all', label: 'All Statuses' },
    { value: 'Complete Under Maintenance', label: 'Under Maintenance' },
    { value: 'Closed', label: 'Closed' }
  ];

  const handleChange = (field, value) => {
    onFilterChange({
      ...filters,
      [field]: value
    });
  };

  const handleClear = () => {
    onFilterChange({
      zone: '',
      work_order_no: '',
      status: '',
      min_surety: '',
      payment_date_from: '',
      payment_date_to: ''
    });
  };

  const hasActiveFilters = Object.values(filters).some(Boolean);

  return (
    <div className="glass-panel p-4 rounded-2xl mb-6 border border-white/10 flex flex-wrap gap-4 items-end">
      {/* Zone Selector */}
      <div className="flex-1 min-w-44">
        <label className="block text-xs font-bold text-slate-300 mb-1.5">
          Zone
        </label>
        <Select
          value={filters.zone || ''}
          onChange={(e) => handleChange('zone', e.target.value)}
          options={zoneOptions}
          disabled={isZo}
        />
      </div>

      {/* Work Order Selector */}
      <div className="flex-1 min-w-56">
        <label className="block text-xs font-bold text-slate-300 mb-1.5">
          Work Order
        </label>
        <Select
          value={filters.work_order_no || ''}
          onChange={(e) => handleChange('work_order_no', e.target.value)}
          options={woOptions}
        />
      </div>

      {/* Work Order Status Selector */}
      <div className="w-44">
        <label className="block text-xs font-bold text-slate-300 mb-1.5">
          Status
        </label>
        <Select
          value={filters.status || ''}
          onChange={(e) => handleChange('status', e.target.value)}
          options={statusOptions}
        />
      </div>

      {/* Min Surety % Selector */}
      <div className="w-36">
        <label className="block text-xs font-bold text-slate-300 mb-1.5">
          Min. Surety %
        </label>
        <Select
          value={filters.min_surety || ''}
          onChange={(e) => handleChange('min_surety', e.target.value)}
          options={suretyOptions}
        />
      </div>

      {/* Payment Date From */}
      <div className="w-44 sm:w-48">
        <label className="block text-xs font-bold text-slate-300 mb-1.5">
          From Date
        </label>
        <Input
          type="date"
          value={filters.payment_date_from || ''}
          onChange={(e) => handleChange('payment_date_from', e.target.value)}
        />
      </div>

      {/* Payment Date To */}
      <div className="w-44 sm:w-48">
        <label className="block text-xs font-bold text-slate-300 mb-1.5">
          To Date
        </label>
        <Input
          type="date"
          value={filters.payment_date_to || ''}
          onChange={(e) => handleChange('payment_date_to', e.target.value)}
        />
      </div>

      {/* Clear Filters Action */}
      {hasActiveFilters && (
        <div>
          <button
            type="button"
            onClick={handleClear}
            className="p-2.5 rounded-xl text-rose-500 hover:text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 transition-all duration-200 flex items-center justify-center"
            title="Clear Filters"
            aria-label="Clear Filters"
          >
            <svg className="w-4 h-4 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
};

export default EstimatedBillFilters;
