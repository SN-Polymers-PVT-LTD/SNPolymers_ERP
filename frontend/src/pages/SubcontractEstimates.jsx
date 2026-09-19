import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../components/AuthContext';
import { Badge, Button, Input, Select, SkeletonCard } from '../components/ui';
import { getSubcontractEstimates, getSubcontractEstimateSummary } from '../api/subcontractEstimatesApi';

const getStatusBadgeVariant = (status) => {
  switch (status) {
    case 'Draft':
      return 'slate';
    case 'Submitted':
      return 'sky';
    case 'Under ZO Review':
      return 'indigo';
    case 'ZO Approved':
      return 'teal';
    case 'Rejected by ZO':
      return 'red';
    case 'Under HO Review':
      return 'purple';
    case 'Final Approved':
      return 'emerald';
    case 'Rejected by HO':
      return 'rose';
    case 'ZO Revision Requested':
      return 'amber';
    case 'HO Revision Requested':
      return 'orange';
    case 'Estimate Reopened':
      return 'amber';
    default:
      return 'slate';
  }
};

const formatINR = (value) => {
  const num = Number(value) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(num);
};

const getAction = (estimate, role) => {
  const status = estimate.estimate_status;
  if (['je', 'admin'].includes(role) && ['Draft', 'ZO Revision Requested', 'HO Revision Requested', 'Estimate Reopened'].includes(status)) {
    return { label: status === 'Draft' ? 'Edit' : 'Revise', path: `/subcontract-estimates/${estimate.subcontract_estimate_id}/edit` };
  }
  if ((role === 'zo' && ['Submitted', 'Under ZO Review'].includes(status)) || (role === 'ho' && ['ZO Approved', 'Under HO Review'].includes(status)) || (role === 'admin' && ['Submitted', 'Under ZO Review', 'ZO Approved', 'Under HO Review'].includes(status))) {
    return { label: 'Review', path: `/subcontract-estimates/${estimate.subcontract_estimate_id}` };
  }
  return { label: 'View', path: `/subcontract-estimates/${estimate.subcontract_estimate_id}` };
};

const SubcontractEstimates = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [hoTab, setHoTab] = useState('active'); // active | history for HO users
  const [selectedFilter, setSelectedFilter] = useState('All'); // 'All' | 'Draft'
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');

  const [estimates, setEstimates] = useState([]);
  const [summaryData, setSummaryData] = useState(null);
  const [pagination, setPagination] = useState({ totalPages: 1, totalItems: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isHO = user?.role === 'ho';
  const canCreate = ['je', 'admin'].includes(user?.role);

  // Fetch estimates list & summary
  const fetchEstimates = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [listRes, sumRes] = await Promise.all([
        getSubcontractEstimates({ page, limit }),
        getSubcontractEstimateSummary().catch(() => null)
      ]);
      setEstimates(listRes.data?.estimates || []);
      setPagination(listRes.data?.pagination || { totalPages: 1, totalItems: 0 });
      if (sumRes?.data?.summary) {
        setSummaryData(sumRes.data.summary);
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to load subcontract estimates.');
    } finally {
      setLoading(false);
    }
  }, [page, limit]);

  useEffect(() => {
    fetchEstimates();
  }, [fetchEstimates]);

  // Compute stats for top horizontal strip
  const totalCount = summaryData?.total ?? pagination.totalItems ?? estimates.length;
  const activeCount = summaryData?.active ?? estimates.filter(
    e => !['Final Approved', 'Rejected by ZO', 'Rejected by HO'].includes(e.estimate_status)
  ).length;
  const submittedCount = summaryData?.submitted ?? estimates.filter(
    e => ['Submitted', 'Under ZO Review', 'Under HO Review'].includes(e.estimate_status)
  ).length;

  // Filtered estimates based on sidebar, search, status filter, and HO tab
  const filteredEstimates = useMemo(() => {
    return estimates.filter((est) => {
      // 1. Sidebar tab filter ('All' vs 'Draft')
      if (selectedFilter === 'Draft' && est.estimate_status !== 'Draft') {
        return false;
      }
      // 2. Status dropdown filter
      if (statusFilter !== 'All' && est.estimate_status !== statusFilter) {
        return false;
      }
      // 3. Search query
      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase();
        const matchWO = est.work_order_no?.toLowerCase().includes(query);
        const matchSite = est.projects_master?.site_details?.toLowerCase().includes(query);
        const matchId = est.subcontract_estimate_id?.toLowerCase().includes(query);
        if (!matchWO && !matchSite && !matchId) return false;
      }
      // 4. HO active vs history tab
      if (isHO) {
        const isHistory = ['Final Approved', 'Rejected by HO'].includes(est.estimate_status);
        if (hoTab === 'active' && isHistory) return false;
        if (hoTab === 'history' && !isHistory) return false;
      }
      return true;
    });
  }, [estimates, selectedFilter, statusFilter, searchQuery, isHO, hoTab]);

  return (
    <>
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-6 pb-6 border-b border-white/5 shrink-0">
        <div>
          <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">Projects Module</span>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Subcontract Estimates</h1>
          <p className="text-xs text-slate-400 font-medium mt-1.5">Manage, review, and track the workflow status of all subcontract estimates.</p>
        </div>
        {isHO && (
          <div className="flex gap-2 bg-white/5 border border-white/10 p-1.5 rounded-xl">
            <Button
              onClick={() => { setHoTab('active'); setPage(1); }}
              variant={hoTab === 'active' ? 'amber' : 'ghost'}
              size="sm"
            >
              Active Queue
            </Button>
            <Button
              onClick={() => { setHoTab('history'); setPage(1); }}
              variant={hoTab === 'history' ? 'amber' : 'ghost'}
              size="sm"
            >
              History Log
            </Button>
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 mb-6 flex items-center gap-2.5 shrink-0">
          <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
          {error}
        </div>
      )}

      {/* 1. Top Horizontal Stats Card */}
      <div className="glass-panel p-5 rounded-2xl mb-8 border border-white/10 bg-gradient-to-r from-white/[0.02] to-amber-500/[0.02] flex justify-around items-center text-center divide-x divide-white/5 shrink-0">
        <div className="flex-1">
          <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block mb-1">Total Estimates</span>
          <span className="text-2xl font-black text-slate-100 font-mono">{totalCount}</span>
        </div>
        <div className="flex-1">
          <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 block mb-1">Active Queue</span>
          <span className="text-2xl font-black text-amber-400 font-mono">{activeCount}</span>
        </div>
        <div className="flex-1">
          <span className="text-[10px] uppercase font-bold tracking-widest text-sky-500 block mb-1">Submitted Sheets</span>
          <span className="text-2xl font-black text-sky-400 font-mono">{submittedCount}</span>
        </div>
      </div>

      {/* 2. Main Two-Column Workspace */}
      <div className="flex flex-col md:flex-row gap-6 flex-grow overflow-hidden min-h-0">
        {/* Left Column: Navigation Sidebar */}
        <div className="w-full md:w-56 flex flex-col gap-4 shrink-0 h-[calc(100vh-270px)]">
          <div className="glass-panel p-4 rounded-2xl border border-white/5 flex flex-col justify-between h-full">
            <div>
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 block mb-4">MY Sheets</span>
              <div className="space-y-2.5">
                <Button
                  onClick={() => setSelectedFilter('All')}
                  variant={selectedFilter === 'All' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="w-full justify-start"
                >
                  All Sheets
                </Button>
                <Button
                  onClick={() => setSelectedFilter('Draft')}
                  variant={selectedFilter === 'Draft' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="w-full justify-start"
                >
                  Draft Sheets
                </Button>
              </div>

              {/* Search input */}
              <div className="mt-5 pt-5 border-t border-white/5 space-y-2">
                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Search Sheets</span>
                <Input
                  type="text"
                  placeholder="Enter WO or Est No..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  size="sm"
                />
              </div>
            </div>

            {/* New Estimate Button */}
            {canCreate && (
              <Button
                onClick={() => navigate('/subcontract-estimates/new')}
                variant="amber"
                className="mt-6 w-full py-4 shadow-lg shadow-amber-500/10 transform hover:-translate-y-0.5 shrink-0"
                icon={
                  <svg className="w-4 h-4 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" />
                  </svg>
                }
                title="Initialize New Subcontract Estimate"
              >
                New Estimate
              </Button>
            )}
          </div>
        </div>

        {/* Right Column: Active Subcontract Estimates Cards */}
        <div className="flex-grow flex flex-col min-h-0 bg-white/[0.01] border border-white/5 rounded-3xl p-6 relative overflow-hidden h-[calc(100vh-270px)]">
          <div className="absolute top-0 right-0 p-6 opacity-[0.03] pointer-events-none">
            <svg className="w-32 h-32 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>

          <div className="flex justify-between items-center mb-6 shrink-0 z-10">
            <h3 className="text-xs uppercase font-extrabold tracking-widest text-slate-400">
              Active Project Subcontract Estimates
            </h3>
            <span className="text-[10px] font-bold text-slate-500 font-mono">
              Found {filteredEstimates.length} results
            </span>
          </div>

          {/* Scrollable list/grid of cards */}
          <div className="flex-grow overflow-y-auto no-scrollbar min-h-0 pr-1 space-y-4 mb-6 z-10">
            {loading ? (
              <div className="space-y-4">
                <SkeletonCard />
                <SkeletonCard />
              </div>
            ) : filteredEstimates.length === 0 ? (
              <div className="text-center py-20 text-slate-500 text-xs uppercase font-extrabold tracking-widest border border-dashed border-white/5 rounded-2xl">
                No matching subcontract estimates found.
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {filteredEstimates.map((est) => {
                  const action = getAction(est, user?.role);
                  return (
                    <div
                      key={est.subcontract_estimate_id}
                      onClick={() => navigate(action.path)}
                      className="glass-panel p-5 rounded-2xl border border-white/5 hover:border-white/10 hover:bg-white/[0.02] cursor-pointer transition duration-300 flex flex-col justify-between gap-4 group relative"
                    >
                      <div className="flex justify-between items-start gap-4">
                        <div className="min-w-0">
                          <span className="text-xl font-black text-amber-500 font-mono tracking-wide block mb-1">
                            WO: {est.work_order_no}
                          </span>
                          <span className="text-xs text-slate-400 font-medium block truncate max-w-xs">
                            {est.projects_master?.site_details || (
                              <span>Revision: <span className="font-mono font-bold text-slate-300">Rev {est.estimate_revision ?? 0}</span></span>
                            )}
                          </span>
                        </div>
                        <div className="flex items-start gap-3 shrink-0">
                          <div className="text-right">
                            <span className="text-[9px] uppercase tracking-wider text-slate-500 font-mono block">Revision</span>
                            <h4 className="text-lg font-black text-slate-100 font-mono leading-tight">
                              Rev {est.estimate_revision ?? 0}
                            </h4>
                          </div>
                          <button
                            type="button"
                            aria-label={`Open estimate for ${est.work_order_no}`}
                            className="h-8 w-8 rounded-xl bg-white/5 group-hover:bg-white/10 border border-white/5 group-hover:border-white/10 flex items-center justify-center text-slate-400 group-hover:text-slate-200 transition-all duration-300 shrink-0"
                          >
                            <svg className="w-4 h-4 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                        </div>
                      </div>

                      <div className="flex justify-between items-center border-t border-white/5 pt-3.5 mt-2">
                        <Badge
                          variant={getStatusBadgeVariant(est.estimate_status)}
                          showDot={false}
                        >
                          {est.estimate_status}
                        </Badge>
                        <div className="text-right">
                          <span className="text-[9px] text-slate-500 uppercase font-bold block">Estimated Amount</span>
                          <span className="text-lg font-black text-slate-200 font-mono">{formatINR(est.estimate_amount)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Bottom Controls: Filters */}
          <div className="border-t border-white/5 pt-5 flex flex-col sm:flex-row gap-4 shrink-0 items-center justify-end z-10">
            <div className="w-full sm:w-auto flex gap-3 items-center shrink-0">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest shrink-0">Status</span>
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                size="sm"
              >
                <option value="All">All Statuses</option>
                <option value="Draft">Draft</option>
                <option value="Submitted">Submitted</option>
                <option value="Under ZO Review">Under ZO Review</option>
                <option value="ZO Approved">ZO Approved</option>
                <option value="Rejected by ZO">Rejected by ZO</option>
                <option value="Under HO Review">Under HO Review</option>
                <option value="Final Approved">Final Approved</option>
                <option value="Rejected by HO">Rejected by HO</option>
                <option value="ZO Revision Requested">ZO Revision Requested</option>
                <option value="HO Revision Requested">HO Revision Requested</option>
                <option value="Estimate Reopened">Estimate Reopened</option>
              </Select>
            </div>
          </div>

          {/* Pagination Controls */}
          {pagination.totalPages > 1 && (
            <div className="mt-4 flex justify-between items-center text-[10px] text-slate-500 shrink-0 font-bold uppercase tracking-wider z-10">
              <span>Page {page} of {pagination.totalPages} ({pagination.totalItems} total)</span>
              <div className="flex gap-2">
                <Button
                  onClick={() => setPage(p => Math.max(p - 1, 1))}
                  disabled={page === 1}
                  size="xs"
                  variant="secondary"
                >
                  Prev
                </Button>
                <Button
                  onClick={() => setPage(p => Math.min(p + 1, pagination.totalPages))}
                  disabled={page === pagination.totalPages}
                  size="xs"
                  variant="secondary"
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default SubcontractEstimates;
