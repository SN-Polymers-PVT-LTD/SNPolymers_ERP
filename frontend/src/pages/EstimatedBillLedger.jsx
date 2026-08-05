import React, { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../components/AuthContext';
import {
  Button,
  SuccessPopup,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableCell,
  Badge,
  SkeletonCard,
  Input
} from '../components/ui';
import EstimatedBillEntryModal from '../components/estimatedBill/EstimatedBillEntryModal';
import {
  getEstimatedBillLedger,
  getWorkOrderOptions,
  createEstimatedBillEntry
} from '../api/estimatedBillsApi';
import { canManageEstimatedBills } from '../utils/estimatedBillPermissions';

const formatCurrency = (val) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(val || 0);
};

const formatDate = (dateStr) => {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
};

const EMPTY_ARRAY = [];

export const EstimatedBillLedger = () => {
  const { work_order_no } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [successPopup, setSuccessPopup] = useState({ isOpen: false, message: '' });

  // Date filters state
  const [paymentDateFrom, setPaymentDateFrom] = useState('');
  const [paymentDateTo, setPaymentDateTo] = useState('');

  // Query: Fetch timeline ledger for this Work Order
  const { data: ledgerData, isLoading: isLedgerLoading } = useQuery({
    queryKey: ['estimated-bill-ledger', work_order_no],
    queryFn: async () => {
      const res = await getEstimatedBillLedger(work_order_no);
      return res.data || { data: [], project: null };
    }
  });

  // Query: Work Order options for picker (required by modal, scoped by backend)
  const { data: workOrdersData } = useQuery({
    queryKey: ['estimated-bill-work-orders'],
    queryFn: async () => {
      const res = await getWorkOrderOptions();
      return res.data?.workOrders || [];
    }
  });

  const entries = ledgerData?.data || EMPTY_ARRAY;
  const project = ledgerData?.project || null;

  const canAddEntry = canManageEstimatedBills({
    role: user?.role,
    status: project?.status,
    finalBillExists: project?.final_bill_exists
  });

  // Filter entries client-side by payment date
  const filteredEntries = useMemo(() => {
    return entries.filter(e => {
      if (paymentDateFrom && e.estimated_payment_date < paymentDateFrom) return false;
      if (paymentDateTo && e.estimated_payment_date > paymentDateTo) return false;
      return true;
    });
  }, [entries, paymentDateFrom, paymentDateTo]);

  // Sorting state
  const [sortConfig, setSortConfig] = useState({ key: '', direction: 'desc' });

  const handleSort = (key) => {
    setSortConfig(prev => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: key === 'estimated_bill_amount' || key === 'surety_pct' || key === 'surety_amount' ? 'desc' : 'asc' };
    });
  };

  const renderSortIcon = (columnKey) => {
    const isActive = sortConfig.key === columnKey;
    return (
      <span className={`ml-1 transition-colors ${isActive ? 'text-amber-400 font-bold' : 'text-slate-600 group-hover:text-slate-400'}`}>
        {isActive ? (sortConfig.direction === 'asc' ? '▲' : '▼') : '↕'}
      </span>
    );
  };

  // Sort filtered entries
  const sortedEntries = useMemo(() => {
    if (!filteredEntries || filteredEntries.length === 0) return [];
    if (!sortConfig.key) return filteredEntries;

    return [...filteredEntries].sort((a, b) => {
      let aVal = a[sortConfig.key];
      let bVal = b[sortConfig.key];

      if (sortConfig.key === 'surety_amount') {
        aVal = (Number(a.estimated_bill_amount || 0) * Number(a.surety_pct || 0) / 100);
        bVal = (Number(b.estimated_bill_amount || 0) * Number(b.surety_pct || 0) / 100);
      } else if (sortConfig.key === 'created_by_name') {
        aVal = a.created_by_name || a.created_by || '';
        bVal = b.created_by_name || b.created_by || '';
      }

      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
      }

      const strA = String(aVal).toLowerCase();
      const strB = String(bVal).toLowerCase();

      if (strA < strB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (strA > strB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredEntries, sortConfig]);

  // Mutation: Add new Entry
  const addMutation = useMutation({
    mutationFn: (payload) => createEstimatedBillEntry(payload),
    onSuccess: () => {
      queryClient.invalidateQueries(['estimated-bill-ledger', work_order_no]);
      queryClient.invalidateQueries(['estimated-bills']);
      setIsModalOpen(false);
      setSuccessPopup({
        isOpen: true,
        message: 'New estimate entry successfully added to the timeline ledger.'
      });
    }
  });

  const handleSaveSubmit = (payload) => {
    addMutation.mutate(payload);
  };

  // Aggregated calculations
  const stats = useMemo(() => {
    if (filteredEntries.length === 0) {
      return {
        totalAmount: 0,
        wtdSuretyPct: 0,
        suretyAmount: 0,
        count: 0,
        latestDate: '—',
        latestUser: '—'
      };
    }

    const totalAmount = filteredEntries.reduce((sum, e) => sum + Number(e.estimated_bill_amount || 0), 0);
    const weightedSuretySum = filteredEntries.reduce((sum, e) => sum + (Number(e.estimated_bill_amount || 0) * Number(e.surety_pct || 0)), 0);
    const wtdSuretyPct = totalAmount > 0 ? parseFloat((weightedSuretySum / totalAmount).toFixed(1)) : 0;
    const suretyAmount = filteredEntries.reduce((sum, e) => sum + (Number(e.estimated_bill_amount || 0) * Number(e.surety_pct || 0) / 100), 0);

    const latest = filteredEntries[0]; // Ordered DESC by backend
    const latestDate = latest.estimated_payment_date
      ? formatDate(latest.estimated_payment_date)
      : '—';

    return {
      totalAmount,
      wtdSuretyPct,
      suretyAmount,
      count: filteredEntries.length,
      latestDate,
      latestUser: latest.updated_by_name || latest.updated_by || '—'
    };
  }, [filteredEntries]);



  const getSuretyBadgeVariant = (surety) => {
    const s = Number(surety) || 0;
    if (s >= 75) return 'emerald';
    if (s >= 50) return 'amber';
    return 'red';
  };

  if (isLedgerLoading) {
    return (
      <div className="space-y-6">
        <div className="h-10 bg-white/5 rounded-xl animate-pulse w-1/4" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full">
      {/* Back Button & Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Link to="/estimated-bills" className="text-xs font-black text-amber-500 uppercase hover:underline flex items-center gap-1">
              ← Back to Overview
            </Link>
          </div>
          <h1 className="text-3xl font-extrabold text-slate-100 tracking-tight">
            Work Order Ledger Sheet
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Timeline of allRecorded billing estimate events for Work Order <span className="font-mono text-amber-400 font-bold">{work_order_no}</span>
          </p>
        </div>

        {canAddEntry && (
          <Button
            variant="primary"
            onClick={() => setIsModalOpen(true)}
            className="shadow-lg shadow-amber-500/20"
          >
            <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            Add Ledger Entry
          </Button>
        )}
      </div>

      {/* Parent Project Master Data Banner Card */}
      {project && (
        <div className="glass-panel p-4 rounded-2xl border border-white/10 bg-white/5 space-y-3">
          <div className="text-[10px] font-extrabold uppercase tracking-widest text-amber-500 font-mono">
            Work Order Contract Master
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div>
              <span className="text-[10px] text-slate-500 uppercase font-mono block">Work Order Value</span>
              <span className="font-extrabold text-slate-200 font-mono tabular-nums">{formatCurrency(project.work_order_value)}</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 uppercase font-mono block">Zone / Department</span>
              <span className="font-bold text-slate-200">{project.zone || '—'} / {project.department || '—'}</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 uppercase font-mono block">District / State</span>
              <span className="font-bold text-slate-200">{project.district || '—'}, {project.state || '—'}</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 uppercase font-mono block">Site Details</span>
              <span className="font-bold text-slate-200 truncate block" title={project.site_details}>{project.site_details || '—'}</span>
            </div>
          </div>
        </div>
      )}

      {/* Aggregated KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
        {/* 1. Total Estimated */}
        <div className="glass-panel p-4 rounded-2xl border border-white/10 flex flex-col justify-between">
          <span className="text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Total Estimated</span>
          <span className="text-xl font-black text-amber-400 font-mono mt-1 tabular-nums">{formatCurrency(stats.totalAmount)}</span>
        </div>
        {/* 2. Weighted Surety */}
        <div className="glass-panel p-4 rounded-2xl border border-white/10 flex flex-col justify-between">
          <span className="text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Wtd. Surety %</span>
          <span className="text-xl font-black text-sky-400 font-mono mt-1 tabular-nums">{stats.wtdSuretyPct}%</span>
        </div>
        {/* 3. Surety Amount */}
        <div className="glass-panel p-4 rounded-2xl border border-white/10 flex flex-col justify-between">
          <span className="text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Surety Amount</span>
          <span className="text-xl font-black text-emerald-400 font-mono mt-1 tabular-nums">{formatCurrency(stats.suretyAmount)}</span>
        </div>
        {/* 4. Number of Entries */}
        <div className="glass-panel p-4 rounded-2xl border border-white/10 flex flex-col justify-between">
          <span className="text-[9px] font-extrabold uppercase tracking-wider text-slate-400"># Entries</span>
          <span className="text-xl font-black text-indigo-400 font-mono mt-1 tabular-nums">{stats.count}</span>
        </div>
        {/* 5. Latest Entry Date */}
        <div className="glass-panel p-4 rounded-2xl border border-white/10 flex flex-col justify-between">
          <span className="text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Latest Entry</span>
          <span className="text-sm font-bold text-slate-200 mt-1">{stats.latestDate}</span>
        </div>
        {/* 6. Latest Updated By */}
        <div className="glass-panel p-4 rounded-2xl border border-white/10 flex flex-col justify-between">
          <span className="text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Latest By</span>
          <span className="text-sm font-bold text-slate-300 mt-1 truncate" title={stats.latestUser}>{stats.latestUser}</span>
        </div>
      </div>

      {/* Date Range Filters */}
      {entries.length > 0 && (
        <div className="glass-panel p-4 rounded-2xl border border-white/10 bg-white/5 flex flex-wrap gap-4 items-end">
          <div className="w-44 sm:w-48">
            <label className="block text-xs font-bold text-slate-300 mb-1.5">
              From Date
            </label>
            <Input
              type="date"
              value={paymentDateFrom}
              onChange={(e) => setPaymentDateFrom(e.target.value)}
            />
          </div>

          <div className="w-44 sm:w-48">
            <label className="block text-xs font-bold text-slate-300 mb-1.5">
              To Date
            </label>
            <Input
              type="date"
              value={paymentDateTo}
              onChange={(e) => setPaymentDateTo(e.target.value)}
            />
          </div>

          {(paymentDateFrom || paymentDateTo) && (
            <div>
              <button
                type="button"
                onClick={() => {
                  setPaymentDateFrom('');
                  setPaymentDateTo('');
                }}
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
      )}

      {/* Timeline Table */}
      {entries.length === 0 ? (
        <div className="glass-panel p-12 text-center rounded-2xl border border-white/10 my-4">
          <svg className="w-12 h-12 text-slate-500 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-sm font-extrabold text-slate-300 uppercase tracking-wider">No entries yet</p>
          <p className="text-xs text-slate-400 mt-1">Click "+ Add Ledger Entry" to record the first estimate timeline event.</p>
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className="glass-panel p-12 text-center rounded-2xl border border-white/10 my-4">
          <svg className="w-12 h-12 text-slate-500 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p className="text-sm font-extrabold text-slate-300 uppercase tracking-wider">No matching entries</p>
          <p className="text-xs text-slate-400 mt-1">No timeline entries match the selected date filter range.</p>
        </div>
      ) : (
        <div className="glass-panel rounded-2xl overflow-hidden border border-white/10">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-white/10 bg-white/5">
                <TableCell isHeader className="text-xs font-bold uppercase text-slate-400 w-16">#</TableCell>
                <TableCell isHeader onClick={() => handleSort('created_at')} className="text-xs font-bold uppercase tracking-wider text-slate-400 cursor-pointer select-none group hover:text-slate-200">
                  Date Added {renderSortIcon('created_at')}
                </TableCell>
                <TableCell isHeader onClick={() => handleSort('estimated_payment_date')} className="text-xs font-bold uppercase tracking-wider text-slate-400 cursor-pointer select-none group hover:text-slate-200">
                  Estimated Date {renderSortIcon('estimated_payment_date')}
                </TableCell>
                <TableCell isHeader onClick={() => handleSort('estimated_bill_amount')} className="text-xs font-bold uppercase tracking-wider text-slate-400 cursor-pointer select-none group hover:text-slate-200">
                  Amount {renderSortIcon('estimated_bill_amount')}
                </TableCell>
                <TableCell isHeader onClick={() => handleSort('surety_pct')} className="text-xs font-bold uppercase tracking-wider text-slate-400 cursor-pointer select-none group hover:text-slate-200">
                  Surety % {renderSortIcon('surety_pct')}
                </TableCell>
                <TableCell isHeader onClick={() => handleSort('surety_amount')} className="text-xs font-bold uppercase tracking-wider text-slate-400 cursor-pointer select-none group hover:text-slate-200">
                  Surety Amount {renderSortIcon('surety_amount')}
                </TableCell>
                <TableCell isHeader onClick={() => handleSort('remarks')} className="text-xs font-bold uppercase tracking-wider text-slate-400 cursor-pointer select-none group hover:text-slate-200">
                  Remarks {renderSortIcon('remarks')}
                </TableCell>
                <TableCell isHeader onClick={() => handleSort('created_by_name')} className="text-xs font-bold uppercase tracking-wider text-slate-400 cursor-pointer select-none group hover:text-slate-200">
                  Added By {renderSortIcon('created_by_name')}
                </TableCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedEntries.map((row, index) => {
                const rowNum = entries.length - entries.indexOf(row);
                const suretyAmt = (Number(row.estimated_bill_amount || 0) * Number(row.surety_pct || 0) / 100);
                return (
                  <TableRow key={row.id || index} className="hover:bg-white/5 transition-colors border-b border-white/5">
                    <TableCell className="font-mono text-xs text-slate-400">{rowNum}</TableCell>
                    <TableCell className="text-xs text-slate-300">{formatDate(row.created_at)}</TableCell>
                    <TableCell className="text-xs text-slate-200 font-semibold">{formatDate(row.estimated_payment_date)}</TableCell>
                    <TableCell className="font-mono text-xs font-extrabold text-slate-100 tabular-nums">{formatCurrency(row.estimated_bill_amount)}</TableCell>
                    <TableCell>
                      <Badge variant={getSuretyBadgeVariant(row.surety_pct)} showDot={false}>
                        {row.surety_pct}%
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs font-bold text-emerald-400 tabular-nums">{formatCurrency(suretyAmt)}</TableCell>
                    <TableCell className="text-xs text-slate-300 italic max-w-xs truncate" title={row.remarks}>{row.remarks || '—'}</TableCell>
                    <TableCell className="text-xs text-slate-400">{row.created_by_name || row.created_by || '—'}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Entry Modal preset and locked to this WO */}
      <EstimatedBillEntryModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        initialWorkOrderNo={work_order_no}
        workOrderOptions={workOrdersData || []}
        onSave={handleSaveSubmit}
        isSaving={addMutation.isPending}
        lockWorkOrder={true}
      />

      {/* Success Feedback Popup */}
      <SuccessPopup
        isOpen={successPopup.isOpen}
        title="Success"
        description={successPopup.message}
        onClose={() => setSuccessPopup(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
};

export default EstimatedBillLedger;
