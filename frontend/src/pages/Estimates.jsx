import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../components/AuthContext';
import BackgroundShapes from '../components/BackgroundShapes';
import Sidebar, { MobileHeader } from '../components/Sidebar';
import authApi from '../api/authApi';

const getStatusBadgeStyles = (status, isOverdue) => {
  if (isOverdue) {
    return 'bg-red-500/15 border-red-500/30 text-red-400 animate-pulse';
  }
  
  switch (status) {
    case 'Draft':
      return 'bg-slate-500/10 border-slate-500/20 text-slate-400';
    case 'Submitted':
      return 'bg-sky-500/10 border-sky-500/20 text-sky-400';
    case 'Under ZO Review':
      return 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400';
    case 'ZO Approved':
      return 'bg-teal-500/10 border-teal-500/20 text-teal-400';
    case 'Rejected by ZO':
      return 'bg-red-500/10 border-red-500/20 text-red-400';
    case 'Under HO Review':
      return 'bg-purple-500/10 border-purple-500/20 text-purple-400';
    case 'Final Approved':
      return 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400';
    case 'Rejected by HO':
      return 'bg-rose-500/10 border-rose-500/20 text-rose-400';
    case 'ZO Revision Requested':
      return 'bg-amber-500/10 border-amber-500/20 text-amber-500';
    case 'HO Revision Requested':
      return 'bg-orange-500/10 border-orange-500/20 text-orange-500';
    default:
      return 'bg-white/5 border-white/5 text-slate-400';
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

const Estimates = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  
  const [estimates, setEstimates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  
  const [hoTab, setHoTab] = useState('active'); // active | history for HO users
  const isJE = user?.role === 'je' || user?.role === 'staff';
  const isHO = user?.role === 'ho';

  useEffect(() => {
    fetchEstimatesList();
  }, [page, hoTab]);

  const fetchEstimatesList = async () => {
    setLoading(true);
    setError('');
    try {
      const params = {
        page,
        limit
      };
      
      if (isHO) {
        params.view = hoTab === 'history' ? 'history' : 'active';
      }
      
      const response = await authApi.get('/estimates', { params });
      if (response.data?.success) {
        setEstimates(response.data.estimates || []);
        setTotalPages(response.data.pagination?.totalPages || 1);
        setTotalItems(response.data.pagination?.total || 0);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to fetch cost estimates.');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  };

  const handleRowClick = (id) => {
    navigate(`/estimates/${id}`);
  };

  return (
    <div className="h-screen bg-black text-slate-100 flex flex-col md:flex-row font-sans relative overflow-hidden">
      <BackgroundShapes />
      <Sidebar />
      <MobileHeader />

      <main className="flex-grow p-6 md:p-10 overflow-y-auto max-w-7xl mx-auto w-full relative z-10">
        
        {/* Header Section */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-8 pb-6 border-b border-white/5">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">Operations Module</span>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Project Cost Estimates</h1>
            <p className="text-xs text-slate-400 font-medium mt-1.5">Manage, review, and track the workflow status of all civil and maintenance estimate sheets.</p>
          </div>
          {(isJE || user?.role === 'admin') && (
            <Link
              to="/estimates/new"
              className="bg-white hover:bg-slate-100 text-slate-950 px-5 py-3 rounded-xl text-xs font-bold uppercase tracking-wider shadow-lg hover:shadow-xl transition-all duration-300 flex items-center gap-2 shrink-0 transform hover:-translate-y-0.5"
            >
              <svg className="w-4 h-4 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
              Create Cost Estimate
            </Link>
          )}
        </div>

        {error && (
          <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 mb-6 flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
            {error}
          </div>
        )}

        {/* HO Queue Tabs */}
        {isHO && (
          <div className="flex gap-6 mb-6 border-b border-white/5">
            <button
              onClick={() => { setHoTab('active'); setPage(1); }}
              className={`pb-3 text-xs font-extrabold uppercase tracking-wider border-b-2 transition-all duration-200 ${
                hoTab === 'active' ? 'border-amber-500 text-slate-100' : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Active Queue
            </button>
            <button
              onClick={() => { setHoTab('history'); setPage(1); }}
              className={`pb-3 text-xs font-extrabold uppercase tracking-wider border-b-2 transition-all duration-200 ${
                hoTab === 'history' ? 'border-amber-500 text-slate-100' : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              History Log
            </button>
          </div>
        )}

        {/* Table List View */}
        <div className="glass-panel rounded-3xl overflow-hidden shadow-2xl border border-white/5">
          {loading ? (
            <div className="flex items-center justify-center p-24">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500" />
            </div>
          ) : estimates.length === 0 ? (
            <div className="text-center p-24 text-slate-400 text-xs uppercase font-extrabold tracking-widest">
              No estimates matching your credential privilege level were found.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/5 bg-white/[0.02] text-[10px] uppercase tracking-widest text-slate-400">
                    <th className="py-4 px-6 font-extrabold">Work Order No</th>
                    <th className="py-4 px-6 font-extrabold">Estimate No</th>
                    <th className="py-4 px-6 font-extrabold">Zonal Office No</th>
                    <th className="py-4 px-6 font-extrabold">Status Badge</th>
                    <th className="py-4 px-6 font-extrabold">Amount (INR)</th>
                    {!isJE && <th className="py-4 px-6 font-extrabold text-center">Revision</th>}
                    <th className="py-4 px-6 font-extrabold text-right">Updated At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-xs text-slate-300">
                  {estimates.map((est) => (
                    <tr
                      key={est.estimate_id}
                      onClick={() => handleRowClick(est.estimate_id)}
                      className="hover:bg-white/[0.02] cursor-pointer transition-colors duration-200"
                    >
                      <td className="py-4 px-6 font-mono font-bold text-slate-100">{est.work_order_no}</td>
                      <td className="py-4 px-6 font-bold text-slate-300">{est.estimate_no || 'N/A'}</td>
                      <td className="py-4 px-6 font-mono text-slate-400">{est.zonal_office_no}</td>
                      <td className="py-4 px-6">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider border ${getStatusBadgeStyles(est.estimate_status, est.is_deadline_overdue)}`}>
                          {est.is_deadline_overdue ? 'DEADLINE OVERDUE' : est.estimate_status}
                        </span>
                      </td>
                      <td className="py-4 px-6 font-semibold text-slate-200">
                        {formatINR(est.estimate_amount)}
                      </td>
                      {!isJE && (
                        <td className="py-4 px-6 font-mono text-center font-bold text-amber-500">
                          R{est.estimate_revision}
                        </td>
                      )}
                      <td className="py-4 px-6 text-right font-medium text-slate-400">
                        {formatDate(est.updated_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination Section */}
        {totalPages > 1 && (
          <div className="mt-8 flex justify-between items-center text-xs text-slate-400">
            <span>Showing page {page} of {totalPages} ({totalItems} total items)</span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(p - 1, 1))}
                disabled={page === 1}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 disabled:opacity-30 disabled:pointer-events-none transition border border-white/5"
              >
                Previous
              </button>
              <button
                onClick={() => setPage(p => Math.min(p + 1, totalPages))}
                disabled={page === totalPages}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 disabled:opacity-30 disabled:pointer-events-none transition border border-white/5"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default Estimates;
