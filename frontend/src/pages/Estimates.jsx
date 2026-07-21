import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../components/AuthContext';
import BackgroundShapes from '../components/BackgroundShapes';
import Sidebar, { MobileHeader } from '../components/Sidebar';
import TopNavbar from '../components/TopNavbar';
import { Button, Input, Select, Badge } from '../components/ui';
import authApi from '../api/authApi';

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

import { useQuery } from '@tanstack/react-query';

const Estimates = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  
  const [hoTab, setHoTab] = useState('active'); // active | history for HO users
  const [selectedFilter, setSelectedFilter] = useState('All'); // 'All' | 'Draft'
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');

  const isJE = user?.role === 'je' || user?.role === 'staff';
  const isHO = user?.role === 'ho';

  // Fetch estimates list using React Query
  const { data: estimatesData, isLoading: loading, error: queryError } = useQuery({
    queryKey: ['estimates', { page, view: isHO ? hoTab : undefined }],
    queryFn: async () => {
      const params = {
        page,
        limit
      };
      
      if (isHO) {
        params.view = hoTab === 'history' ? 'history' : 'active';
      }
      
      const response = await authApi.get('/estimates', { params });
      return response.data;
    },
    staleTime: 30 * 1000
  });

  const estimates = estimatesData?.estimates || [];
  const totalPages = estimatesData?.pagination?.totalPages || 1;
  const totalItems = estimatesData?.pagination?.total || 0;

  const displayError = queryError?.response?.data?.message || queryError?.message || '';



  const handleCardClick = (id) => {
    navigate(`/estimates/${id}`);
  };

  // Compute stats for the top card
  const totalCount = totalItems;
  const activeCount = estimates.filter(
    e => !['Final Approved', 'Rejected by ZO', 'Rejected by HO'].includes(e.estimate_status)
  ).length;
  const submittedCount = estimates.filter(
    e => ['Submitted', 'Under ZO Review', 'Under HO Review'].includes(e.estimate_status)
  ).length;

  // Filter logic on the client side for search/filters
  const filteredEstimates = estimates.filter(e => {
    // 1. Sidebar tab filter ('All' vs 'Draft')
    if (selectedFilter === 'Draft' && e.estimate_status !== 'Draft') {
      return false;
    }
    // 2. Bottom status filter
    if (statusFilter !== 'All' && e.estimate_status !== statusFilter) {
      return false;
    }
    // 3. Search Bar query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchWO = e.work_order_no?.toLowerCase().includes(query);
      const matchEstNo = e.estimate_no?.toLowerCase().includes(query);
      return matchWO || matchEstNo;
    }
    return true;
  });

  return (
    <>
        
        {/* Header Section */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-6 pb-6 border-b border-white/5 shrink-0">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">Projects Module</span>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Cost Estimate Sheets</h1>
            <p className="text-xs text-slate-400 font-medium mt-1.5">Manage, review, and track the workflow status of all cost estimate sheets.</p>
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

        {displayError && (
          <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 mb-6 flex items-center gap-2.5 shrink-0">
            <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
            {displayError}
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
          
          {/* Left Column: MY Sheets Navigation */}
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

                {/* Search input option */}
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
              
              {/* Plus Button inside MY Sheets card to Initialize New Sheet */}
              {(isJE || user?.role === 'admin') && (
                <Button
                  onClick={() => navigate('/estimates/new')}
                  variant="amber"
                  className="mt-6 w-full py-4 shadow-lg shadow-amber-500/10 transform hover:-translate-y-0.5 shrink-0"
                  icon={
                    <svg className="w-4 h-4 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" />
                    </svg>
                  }
                  title="Initialize New Cost Estimate Sheet"
                >
                  New Sheet
                </Button>
              )}
            </div>
          </div>

          {/* Right Column: Active Project Cost Estimate Sheets Card Grid / List */}
          <div className="flex-grow flex flex-col min-h-0 bg-white/[0.01] border border-white/5 rounded-3xl p-6 relative overflow-hidden h-[calc(100vh-270px)]">
            <div className="absolute top-0 right-0 p-6 opacity-[0.03] pointer-events-none">
              <svg className="w-32 h-32 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            
            <div className="flex justify-between items-center mb-6 shrink-0 z-10">
              <h3 className="text-xs uppercase font-extrabold tracking-widest text-slate-400">Active Project Cost Estimate Sheets</h3>
              <span className="text-[10px] font-bold text-slate-500 font-mono">Found {filteredEstimates.length} results</span>
            </div>

            {/* Scrollable list/grid of cards */}
            <div className="flex-grow overflow-y-auto no-scrollbar min-h-0 pr-1 space-y-4 mb-6 z-10">
              {loading ? (
                <div className="flex flex-col items-center justify-center p-24 gap-3">
                  <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Retrieving ledger details...</span>
                </div>
              ) : filteredEstimates.length === 0 ? (
                <div className="text-center py-20 text-slate-500 text-xs uppercase font-extrabold tracking-widest border border-dashed border-white/5 rounded-2xl">
                  No matching estimate sheets found.
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {filteredEstimates.map((est) => (
                    <div
                      key={est.estimate_id}
                      onClick={() => handleCardClick(est.estimate_id)}
                      className="glass-panel p-5 rounded-2xl border border-white/5 hover:border-white/10 hover:bg-white/[0.02] cursor-pointer transition duration-300 flex flex-col justify-between gap-4 group relative"
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="text-[9px] font-bold text-amber-500 font-mono tracking-wider block mb-1">WO: {est.work_order_no}</span>
                          <h4 className="text-sm font-extrabold text-slate-200 group-hover:text-slate-100 transition-colors">
                            {est.estimate_no || 'Pending Auto ID'}
                          </h4>
                          <span className="text-[10px] text-slate-400 font-medium block mt-1">Area Code: <span className="font-mono font-bold text-slate-300">{est.area_code}</span></span>
                        </div>
                        <button className="h-8 w-8 rounded-xl bg-white/5 group-hover:bg-white/10 border border-white/5 group-hover:border-white/10 flex items-center justify-center text-slate-400 group-hover:text-slate-200 transition-all duration-300 shrink-0">
                          <svg className="w-4 h-4 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      </div>

                      <div className="flex justify-between items-center border-t border-white/5 pt-3.5 mt-2">
                        <Badge
                          variant={est.is_deadline_overdue ? 'red' : getStatusBadgeVariant(est.estimate_status)}
                          showDot={false}
                          className={est.is_deadline_overdue ? 'animate-pulse' : ''}
                        >
                          {est.is_deadline_overdue ? 'DEADLINE OVERDUE' : est.estimate_status}
                        </Badge>
                        <div className="text-right">
                          <span className="text-[9px] text-slate-500 uppercase font-bold block">Estimated Amount</span>
                          <span className="text-sm font-black text-slate-200 font-mono">{formatINR(est.estimate_amount)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 3. Bottom Controls: Filters */}
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
            {totalPages > 1 && (
              <div className="mt-4 flex justify-between items-center text-[10px] text-slate-500 shrink-0 font-bold uppercase tracking-wider z-10">
                <span>Page {page} of {totalPages} ({totalItems} total)</span>
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
                    onClick={() => setPage(p => Math.min(p + 1, totalPages))}
                    disabled={page === totalPages}
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

export default Estimates;
