import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../components/AuthContext';
import BackgroundShapes from '../components/BackgroundShapes';
import Sidebar, { MobileHeader } from '../components/Sidebar';
import { getProjects } from '../api/projectsApi';
import {
  getBills,
  getBillById,
  createBill,
  getBillSummary,
  uploadBillCopy
} from '../api/raFinalBillApi';

// Helper for currency formatting (Indian format)
const formatCurrency = (val) => {
  if (val == null || isNaN(val)) return '₹ 0.00';
  return `₹ ${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// Helper for simple date formatting
const formatDate = (dateStr) => {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

// Helper for detail view date-time formatting
const formatDateTime = (dateStr) => {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
};

const RAFinalBill = () => {
  const { user } = useAuth();
  
  // Navigation / View State
  const [bills, setBills] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // UI Panels
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [selectedBillId, setSelectedBillId] = useState(null);
  const [detailBill, setDetailBill] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Search/Filter states
  const [filterWO, setFilterWO] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalBillsCount, setTotalBillsCount] = useState(0);

  // Create Form State
  const [formState, setFormState] = useState({
    work_order_no: '',
    payment_type: '',
    bill_date: '',
    bill_no: '',
    bill_amount_with_gst: '',
    earnest_money_deposit: '',
    security_deposit_amount: '',
    bill_copy_url: '',
    original_bill_filename: '',
    remarks: ''
  });

  // Project auto-fetched states
  const [projectDetails, setProjectDetails] = useState({
    state: 'Auto',
    district: 'Auto',
    area_code: 'Auto',
    department: 'Auto',
    site_details: 'Auto'
  });

  // Summary and dropdown options from API
  const [summaryData, setSummaryData] = useState({
    work_order_value: 0,
    previous_bill_amount: 0,
    dropdown_options: []
  });

  // Upload States
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef(null);

  // Stats
  const [stats, setStats] = useState({
    totalBills: 0,
    totalBilledAmount: 0,
    finalBillsCount: 0
  });

  // Fetch all bills for list view
  const fetchBillsList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = {
        page,
        limit: 10,
        work_order_no: filterWO || undefined,
        payment_type: filterType || undefined,
        date_from: filterDateFrom || undefined,
        date_to: filterDateTo || undefined
      };
      const res = await getBills(params);
      if (res.data?.success) {
        setBills(res.data.bills ?? []);
        setTotalPages(res.data.pagination.totalPages || 1);
        setTotalBillsCount(res.data.pagination.total || 0);
      }
    } catch (err) {
      console.error('Failed to fetch bills:', err);
      setError(err.response?.data?.message || 'Failed to retrieve bill list.');
    } finally {
      setLoading(false);
    }
  }, [page, filterWO, filterType, filterDateFrom, filterDateTo]);

  // Fetch projects and compute overview metrics
  const fetchInitialData = useCallback(async () => {
    try {
      const projRes = await getProjects();
      if (projRes.data?.projects) {
        setProjects(projRes.data.projects);
      }
      
      // Fetch stats by retrieving all bills
      const statsRes = await getBills({ limit: 1000 });
      if (statsRes.data?.success) {
        const all = statsRes.data.bills || [];
        const totalAmt = all.reduce((sum, b) => sum + Number(b.bill_amount_with_gst || 0), 0);
        const finalCount = all.filter(b => b.payment_type === 'Final Bill').length;
        setStats({
          totalBills: all.length,
          totalBilledAmount: totalAmt,
          finalBillsCount: finalCount
        });
      }
    } catch (err) {
      console.error('Failed to load initial data:', err);
    }
  }, []);

  useEffect(() => {
    fetchBillsList();
  }, [fetchBillsList]);

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  // Handle Work Order selection change
  const handleWorkOrderChange = async (e) => {
    const wo = e.target.value;
    
    // Reset dependant form fields
    setFormState(prev => ({
      ...prev,
      work_order_no: wo,
      payment_type: '',
      bill_amount_with_gst: '',
      earnest_money_deposit: '',
      security_deposit_amount: '',
      bill_copy_url: '',
      original_bill_filename: ''
    }));

    if (!wo) {
      setProjectDetails({
        state: 'Auto',
        district: 'Auto',
        area_code: 'Auto',
        department: 'Auto',
        site_details: 'Auto'
      });
      setSummaryData({
        work_order_value: 0,
        previous_bill_amount: 0,
        dropdown_options: []
      });
      return;
    }

    // Set temporary loading states
    setProjectDetails({
      state: 'Loading...',
      district: 'Loading...',
      area_code: 'Loading...',
      department: 'Loading...',
      site_details: 'Loading...'
    });

    try {
      // Find matching project in local list
      const proj = projects.find(p => p.work_order_no === wo);
      if (proj) {
        setProjectDetails({
          state: proj.state,
          district: proj.district,
          area_code: proj.zone || 'N/A',
          department: proj.department,
          site_details: proj.site_details
        });
      }

      // Fetch summary stats & options
      const summaryRes = await getBillSummary(wo);
      if (summaryRes.data?.success) {
        setSummaryData({
          work_order_value: summaryRes.data.work_order_value,
          previous_bill_amount: summaryRes.data.previous_bill_amount,
          dropdown_options: summaryRes.data.dropdown_options
        });
      }
    } catch (err) {
      console.error('Error fetching work order metadata:', err);
      setError('Failed to fetch details for selected work order.');
    }
  };

  // Two-step file upload
  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError('');

    // Client-side validations
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!allowedTypes.includes(file.type)) {
      setUploadError('Only PDF, JPG, JPEG, or PNG files are accepted.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setUploadError('File size must not exceed 5MB.');
      return;
    }

    setUploading(true);
    try {
      const res = await uploadBillCopy(file);
      if (res.data?.success) {
        setFormState(prev => ({
          ...prev,
          bill_copy_url: res.data.bill_copy_url,
          original_bill_filename: res.data.original_filename
        }));
      }
    } catch (err) {
      console.error('File upload failed:', err);
      setUploadError(err.response?.data?.message || 'File upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  // Form Reset
  const handleReset = () => {
    const currentWO = formState.work_order_no;
    setFormState({
      work_order_no: currentWO, // preserve WO selection
      payment_type: '',
      bill_date: '',
      bill_no: '',
      bill_amount_with_gst: '',
      earnest_money_deposit: '',
      security_deposit_amount: '',
      bill_copy_url: '',
      original_bill_filename: '',
      remarks: ''
    });
    setUploadError('');
    if (fileInputRef.current) {
      fileInputRef.current.value = null;
    }
    // Re-fetch summary if WO is still selected
    if (currentWO) {
      getBillSummary(currentWO).then(res => {
        if (res.data?.success) {
          setSummaryData({
            work_order_value: res.data.work_order_value,
            previous_bill_amount: res.data.previous_bill_amount,
            dropdown_options: res.data.dropdown_options
          });
        }
      });
    }
  };

  // Form Cancel
  const handleCancel = () => {
    handleReset();
    setFormState({
      work_order_no: '',
      payment_type: '',
      bill_date: '',
      bill_no: '',
      bill_amount_with_gst: '',
      earnest_money_deposit: '',
      security_deposit_amount: '',
      bill_copy_url: '',
      original_bill_filename: '',
      remarks: ''
    });
    setProjectDetails({
      state: 'Auto',
      district: 'Auto',
      area_code: 'Auto',
      department: 'Auto',
      site_details: 'Auto'
    });
    setSummaryData({
      work_order_value: 0,
      previous_bill_amount: 0,
      dropdown_options: []
    });
    setShowCreatePanel(false);
  };

  // Form Submit (Save Draft)
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Check all required inputs
    const required = ['work_order_no', 'payment_type', 'bill_date', 'bill_no', 'bill_amount_with_gst', 'bill_copy_url'];
    for (const f of required) {
      if (!formState[f]) {
        setError(`Please check all fields. ${f.replace(/_/g, ' ')} is required.`);
        return;
      }
    }

    setSubmitting(true);
    try {
      const payload = {
        work_order_no: formState.work_order_no,
        payment_type: formState.payment_type,
        bill_date: formState.bill_date,
        bill_no: formState.bill_no,
        bill_amount_with_gst: Number(formState.bill_amount_with_gst),
        earnest_money_deposit: Number(formState.earnest_money_deposit || 0),
        security_deposit_amount: Number(formState.security_deposit_amount || 0),
        bill_copy_url: formState.bill_copy_url,
        original_bill_filename: formState.original_bill_filename || null,
        remarks: formState.remarks || null
      };

      const res = await createBill(payload);
      if (res.data?.success) {
        setSuccess('Bill entry saved successfully.');
        handleCancel();
        fetchBillsList();
        fetchInitialData();
      }
    } catch (err) {
      console.error('Failed to save bill entry:', err);
      setError(err.response?.data?.message || 'Failed to submit bill entry.');
    } finally {
      setSubmitting(false);
    }
  };

  // View single bill details
  const handleViewBill = async (billId) => {
    setLoadingDetail(true);
    setSelectedBillId(billId);
    setDetailBill(null);
    try {
      const res = await getBillById(billId);
      if (res.data?.success) {
        setDetailBill(res.data.bill);
      }
    } catch (err) {
      console.error('Failed to load bill details:', err);
      setError('Failed to fetch details for selected bill.');
    } finally {
      setLoadingDetail(false);
    }
  };

  // Live Calculations for Summary Panel
  const woValue = summaryData.work_order_value || 0;
  const prevBilled = summaryData.previous_bill_amount || 0;
  const currentBilled = Number(formState.bill_amount_with_gst) || 0;
  const totalBilled = prevBilled + currentBilled;
  const balanceRemaining = woValue - totalBilled;

  // Formatting date for right footer
  const currentSystemDateTime = formatDateTime(new Date());

  return (
    <div className="h-screen bg-black text-slate-100 flex flex-col md:flex-row font-sans relative overflow-hidden">
      <BackgroundShapes />
      <Sidebar />
      <MobileHeader />

      <main className="flex-grow p-6 md:p-10 overflow-y-auto w-full relative z-10">
        {/* Status Alerts */}
        {error && (
          <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 mb-5 flex items-center gap-2.5 shadow-lg animate-fadeIn">
            <span className="w-2 h-2 rounded-full bg-red-500 shrink-0 animate-ping" />
            {error}
          </div>
        )}
        {success && (
          <div className="p-4 bg-emerald-950/20 border border-emerald-900/30 rounded-2xl text-xs text-emerald-300 mb-5 flex items-center gap-2.5 shadow-lg animate-fadeIn">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            {success}
          </div>
        )}

        {/* Header Bar */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 pb-6 border-b border-white/5 mb-6">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-widest text-indigo-400 font-mono">
              Finance & Billing
            </span>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">RA / Final Bill Entry</h1>
            <p className="text-xs text-slate-400 font-medium mt-1.5">
              SubmitRunning Account bills and final financial settlements for Work Orders.
            </p>
          </div>
          <button
            onClick={() => setShowCreatePanel(true)}
            className="bg-white hover:bg-slate-100 text-slate-950 px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition shadow flex items-center gap-2"
          >
            <svg className="w-4 h-4 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Bill Entry
          </button>
        </div>

        {/* Stats Cards Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
          <div className="glass-panel p-5 rounded-3xl border border-white/5 flex items-center justify-between">
            <div>
              <span className="text-[9px] uppercase font-extrabold tracking-widest text-slate-500">Total Bills Entered</span>
              <h3 className="text-2xl font-black text-slate-100 mt-1">{stats.totalBills}</h3>
            </div>
            <div className="p-3 bg-white/5 rounded-2xl text-slate-400">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2" />
              </svg>
            </div>
          </div>
          <div className="glass-panel p-5 rounded-3xl border border-white/5 flex items-center justify-between">
            <div>
              <span className="text-[9px] uppercase font-extrabold tracking-widest text-slate-500">Total Billed Amount</span>
              <h3 className="text-xl font-black text-indigo-400 mt-1">{formatCurrency(stats.totalBilledAmount)}</h3>
            </div>
            <div className="p-3 bg-indigo-950/20 text-indigo-400 border border-indigo-900/30 rounded-2xl">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <div className="glass-panel p-5 rounded-3xl border border-white/5 flex items-center justify-between">
            <div>
              <span className="text-[9px] uppercase font-extrabold tracking-widest text-slate-500">Final Settlements</span>
              <h3 className="text-2xl font-black text-emerald-400 mt-1">{stats.finalBillsCount}</h3>
            </div>
            <div className="p-3 bg-emerald-950/20 text-emerald-400 border border-emerald-900/30 rounded-2xl">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="glass-panel p-5 rounded-3xl border border-white/5 mb-6">
          <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 block mb-3">Filters</span>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div>
              <label className="block text-[9px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">Work Order No</label>
              <input
                type="text"
                placeholder="Search WO..."
                value={filterWO}
                onChange={(e) => setFilterWO(e.target.value)}
                className="w-full bg-white/5 border border-white/5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-200 outline-none focus:border-indigo-500 transition"
              />
            </div>
            <div>
              <label className="block text-[9px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">Payment Type</label>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="w-full bg-white/5 border border-white/5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-200 outline-none focus:border-indigo-500 transition"
              >
                <option value="">All Types</option>
                <option value="RA Bill">RA Bills</option>
                <option value="Final Bill">Final Bills</option>
              </select>
            </div>
            <div>
              <label className="block text-[9px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">Date From</label>
              <input
                type="date"
                value={filterDateFrom}
                onChange={(e) => setFilterDateFrom(e.target.value)}
                className="w-full bg-white/5 border border-white/5 rounded-xl px-3 py-2 text-xs font-mono font-semibold text-slate-200 outline-none focus:border-indigo-500 transition"
              />
            </div>
            <div>
              <label className="block text-[9px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">Date To</label>
              <input
                type="date"
                value={filterDateTo}
                onChange={(e) => setFilterDateTo(e.target.value)}
                className="w-full bg-white/5 border border-white/5 rounded-xl px-3 py-2 text-xs font-mono font-semibold text-slate-200 outline-none focus:border-indigo-500 transition"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-4 pt-4 border-t border-white/5">
            <button
              onClick={() => {
                setFilterWO('');
                setFilterType('');
                setFilterDateFrom('');
                setFilterDateTo('');
              }}
              className="text-[10px] uppercase font-bold text-slate-400 hover:text-slate-200 px-3 py-1.5"
            >
              Reset Filters
            </button>
            <button
              onClick={fetchBillsList}
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] uppercase font-bold px-4 py-1.5 rounded-xl transition shadow"
            >
              Apply Filter
            </button>
          </div>
        </div>

        {/* Bills Table List */}
        <div className="glass-panel rounded-3xl border border-white/5 overflow-hidden shadow-2xl bg-gradient-to-br from-white/[0.01] to-transparent">
          <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/[0.01]">
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Bill Entries Ledger</span>
            <span className="text-[10px] font-mono font-bold text-indigo-400">Total: {totalBillsCount} records</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-white/5 text-[9px] uppercase font-bold tracking-widest text-slate-400 bg-white/[0.02]">
                  <th className="p-3 text-center w-12 border-r border-white/5">Sl No.</th>
                  <th className="p-3 border-r border-white/5">Work Order No</th>
                  <th className="p-3 border-r border-white/5">Payment Type</th>
                  <th className="p-3 border-r border-white/5">Bill Date</th>
                  <th className="p-3 border-r border-white/5">Bill No</th>
                  <th className="p-3 text-right border-r border-white/5">Bill Amount (GST)</th>
                  <th className="p-3 border-r border-white/5">Uploaded By</th>
                  <th className="p-3">Created At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {loading ? (
                  <tr>
                    <td colSpan="8" className="p-8 text-center text-slate-500 font-medium">
                      <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-indigo-500 inline-block mb-2" />
                      <p className="text-xs uppercase tracking-widest">Loading entries...</p>
                    </td>
                  </tr>
                ) : bills.length === 0 ? (
                  <tr>
                    <td colSpan="8" className="p-8 text-center text-slate-500 font-medium italic">
                      No bill entries found matching the filter criteria.
                    </td>
                  </tr>
                ) : (
                  bills.map((bill, idx) => (
                    <tr
                      key={bill.bill_id}
                      onClick={() => handleViewBill(bill.bill_id)}
                      className="hover:bg-white/[0.02] cursor-pointer transition duration-150 text-slate-300"
                    >
                      <td className="p-3 text-center font-mono font-semibold border-r border-white/5 text-slate-500">
                        {idx + 1 + (page - 1) * 10}
                      </td>
                      <td className="p-3 font-semibold border-r border-white/5 text-slate-200">
                        {bill.work_order_no}
                      </td>
                      <td className="p-3 border-r border-white/5">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-[9px] font-bold uppercase tracking-wider border ${
                          bill.payment_type.startsWith('RA')
                            ? 'bg-amber-500/10 border-amber-500/25 text-amber-400'
                            : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
                        }`}>
                          <span className={`w-1 h-1 rounded-full ${bill.payment_type.startsWith('RA') ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                          {bill.payment_type}
                        </span>
                      </td>
                      <td className="p-3 font-mono border-r border-white/5">
                        {formatDate(bill.bill_date)}
                      </td>
                      <td className="p-3 border-r border-white/5 truncate max-w-[120px]" title={bill.bill_no}>
                        {bill.bill_no}
                      </td>
                      <td className="p-3 text-right font-mono font-bold text-slate-200 border-r border-white/5">
                        {formatCurrency(bill.bill_amount_with_gst)}
                      </td>
                      <td className="p-3 border-r border-white/5 truncate max-w-[120px]" title={bill.created_by_name}>
                        {bill.created_by_name}
                      </td>
                      <td className="p-3 font-mono text-slate-500">
                        {formatDateTime(bill.created_at)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="p-4 border-t border-white/5 bg-white/[0.01] flex justify-between items-center">
              <button
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(p - 1, 1))}
                className="px-3 py-1.5 rounded-lg text-xs font-bold uppercase bg-white/5 border border-white/5 hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-white/5 transition"
              >
                Previous
              </button>
              <span className="text-xs text-slate-400">Page {page} of {totalPages}</span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(p => Math.min(p + 1, totalPages))}
                className="px-3 py-1.5 rounded-lg text-xs font-bold uppercase bg-white/5 border border-white/5 hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-white/5 transition"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </main>

      {/* CREATE FORM OVERLAY SLIDE PANEL (Mirrors the exact design inspiration layout) */}
      {showCreatePanel && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex justify-end z-50 animate-fadeIn">
          <div className="w-full max-w-4xl bg-slate-950 border-l border-white/10 h-full flex flex-col justify-between shadow-[-10px_0_40px_rgba(0,0,0,0.8)] overflow-y-auto relative animate-slideLeft">
            
            {/* Header Block */}
            <div className="bg-indigo-950/20 border-b border-white/10 p-5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-indigo-500/10 border border-indigo-500/20">
                  <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h2 className="text-base font-extrabold uppercase tracking-widest text-slate-100">
                  RA / FINAL BILL ENTRY
                </h2>
              </div>
              <button
                onClick={handleCancel}
                disabled={submitting}
                className="text-slate-400 hover:text-slate-200 transition-colors p-1"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Scrollable Form Body */}
            <form onSubmit={handleSubmit} className="flex-grow p-6 space-y-6 overflow-y-auto">
              
              {/* SECTION 1: PROJECT DETAILS */}
              <div className="border border-white/5 bg-slate-900/20 rounded-2xl p-5 space-y-4 shadow-sm">
                <div className="flex items-center gap-2 border-b border-white/5 pb-2">
                  <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                  <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400 font-mono">
                    PROJECT DETAILS <span className="text-slate-500 font-medium">(Auto Fetch from Work Order)</span>
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-[9px] font-extrabold text-slate-400 uppercase tracking-widest mb-1.5">
                      Work Order No <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={formState.work_order_no}
                      onChange={handleWorkOrderChange}
                      required
                      disabled={submitting}
                      className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs font-semibold text-slate-100 outline-none focus:border-indigo-500 transition"
                    >
                      <option value="">-- Select Work Order No --</option>
                      {projects.map((p) => (
                        <option key={p.work_order_no} value={p.work_order_no}>
                          {p.work_order_no}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[9px] font-extrabold text-slate-400 uppercase tracking-widest mb-1.5">State</label>
                    <input
                      type="text"
                      disabled
                      value={projectDetails.state}
                      className="w-full bg-white/[0.02] border border-white/5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-500 cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-extrabold text-slate-400 uppercase tracking-widest mb-1.5">District</label>
                    <input
                      type="text"
                      disabled
                      value={projectDetails.district}
                      className="w-full bg-white/[0.02] border border-white/5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-500 cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-extrabold text-slate-400 uppercase tracking-widest mb-1.5">Area Code</label>
                    <input
                      type="text"
                      disabled
                      value={projectDetails.area_code}
                      className="w-full bg-white/[0.02] border border-white/5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-500 cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-extrabold text-slate-400 uppercase tracking-widest mb-1.5">Department</label>
                    <input
                      type="text"
                      disabled
                      value={projectDetails.department}
                      className="w-full bg-white/[0.02] border border-white/5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-500 cursor-not-allowed"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[9px] font-extrabold text-slate-400 uppercase tracking-widest mb-1.5">Site Details</label>
                  <textarea
                    disabled
                    value={projectDetails.site_details}
                    rows={2}
                    className="w-full bg-white/[0.02] border border-white/5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-500 cursor-not-allowed resize-none"
                  />
                </div>
              </div>

              {/* SECTION 2: BILL DETAILS */}
              <div className="border border-white/5 bg-slate-900/20 rounded-2xl p-5 space-y-4 shadow-sm animate-fadeIn">
                <div className="flex items-center gap-2 border-b border-white/5 pb-2">
                  <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400 font-mono">
                    BILL DETAILS
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[9px] font-extrabold text-slate-400 uppercase tracking-widest mb-1.5">
                      Type of Payment <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={formState.payment_type}
                      onChange={(e) => setFormState(prev => ({ ...prev, payment_type: e.target.value }))}
                      required
                      disabled={!formState.work_order_no || submitting}
                      className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs font-semibold text-slate-200 outline-none focus:border-indigo-500 transition disabled:opacity-50"
                    >
                      <option value="">
                        {!formState.work_order_no ? '-- Select Work Order First --' : '-- Select Type of Payment --'}
                      </option>
                      {summaryData.dropdown_options.map((opt) => (
                        <option key={opt.value} value={opt.value} disabled={!opt.available}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[9px] font-extrabold text-slate-400 uppercase tracking-widest mb-1.5">
                      Bill Date <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      value={formState.bill_date}
                      onChange={(e) => setFormState(prev => ({ ...prev, bill_date: e.target.value }))}
                      required
                      disabled={submitting}
                      className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs font-mono font-semibold text-slate-100 outline-none focus:border-indigo-500 transition"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-extrabold text-slate-400 uppercase tracking-widest mb-1.5">
                      Bill No <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="Enter Bill No"
                      value={formState.bill_no}
                      onChange={(e) => setFormState(prev => ({ ...prev, bill_no: e.target.value }))}
                      required
                      disabled={submitting}
                      className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs font-semibold text-slate-100 outline-none focus:border-indigo-500 transition"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-extrabold text-slate-400 uppercase tracking-widest mb-1.5">
                      Bill Amount With GST <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-xs text-slate-500 font-bold">₹</span>
                      <input
                        type="number"
                        placeholder="Enter Amount"
                        step="0.01"
                        value={formState.bill_amount_with_gst}
                        onChange={(e) => setFormState(prev => ({ ...prev, bill_amount_with_gst: e.target.value }))}
                        required
                        disabled={submitting}
                        className="w-full bg-slate-900 border border-white/10 rounded-xl pl-7 pr-3 py-2 text-xs font-mono font-bold text-slate-100 outline-none focus:border-indigo-500 transition"
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <label className="block text-[9px] font-extrabold text-slate-400 uppercase tracking-widest">
                        Earnest Money Deposit
                      </label>
                      <svg className="w-3.5 h-3.5 text-indigo-400 cursor-pointer" fill="currentColor" viewBox="0 0 20 20" title="EMD deduction if applicable">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-xs text-slate-500 font-bold">₹</span>
                      <input
                        type="number"
                        placeholder="Enter Amount"
                        step="0.01"
                        value={formState.earnest_money_deposit}
                        onChange={(e) => setFormState(prev => ({ ...prev, earnest_money_deposit: e.target.value }))}
                        disabled={submitting}
                        className="w-full bg-slate-900 border border-white/10 rounded-xl pl-7 pr-3 py-2 text-xs font-mono font-semibold text-slate-100 outline-none focus:border-indigo-500 transition"
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <label className="block text-[9px] font-extrabold text-slate-400 uppercase tracking-widest">
                        Security Deposit Amount
                      </label>
                      <svg className="w-3.5 h-3.5 text-indigo-400 cursor-pointer" fill="currentColor" viewBox="0 0 20 20" title="SD deduction if applicable">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-xs text-slate-500 font-bold">₹</span>
                      <input
                        type="number"
                        placeholder="Enter Amount"
                        step="0.01"
                        value={formState.security_deposit_amount}
                        onChange={(e) => setFormState(prev => ({ ...prev, security_deposit_amount: e.target.value }))}
                        disabled={submitting}
                        className="w-full bg-slate-900 border border-white/10 rounded-xl pl-7 pr-3 py-2 text-xs font-mono font-semibold text-slate-100 outline-none focus:border-indigo-500 transition"
                      />
                    </div>
                  </div>
                  
                  {/* File Upload Component */}
                  <div>
                    <label className="block text-[9px] font-extrabold text-slate-400 uppercase tracking-widest mb-1.5">
                      Upload Bill Copy <span className="text-red-500">*</span>
                    </label>
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        <input
                          type="file"
                          ref={fileInputRef}
                          accept="application/pdf,image/jpeg,image/png"
                          onChange={handleFileSelect}
                          className="hidden"
                          id="bill-copy-upload-input"
                        />
                        <label
                          htmlFor="bill-copy-upload-input"
                          className="cursor-pointer bg-white/5 border border-white/15 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider text-slate-300 hover:bg-white/10 transition shrink-0"
                        >
                          Choose File
                        </label>
                        <span className="text-xs text-slate-400 truncate max-w-[200px]" title={formState.original_bill_filename}>
                          {formState.original_bill_filename || 'No file chosen'}
                        </span>
                      </div>
                      
                      {uploading ? (
                        <div className="flex items-center gap-2 mt-1">
                          <span className="animate-spin rounded-full h-3.5 w-3.5 border-t-2 border-b-2 border-indigo-500" />
                          <span className="text-[10px] text-slate-400 font-bold uppercase">Uploading...</span>
                        </div>
                      ) : formState.bill_copy_url ? (
                        <span className="text-[10px] text-emerald-400 font-extrabold flex items-center gap-1 mt-1">
                          ✓ Uploaded Successfully
                        </span>
                      ) : null}

                      {uploadError && <p className="text-[10px] text-red-400 leading-tight">{uploadError}</p>}
                      <p className="text-[9px] text-indigo-400 mt-1">(PDF / JPG / JPEG / PNG, Max Size 5MB)</p>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[9px] font-extrabold text-slate-400 uppercase tracking-widest mb-1.5">Remarks</label>
                    <textarea
                      placeholder="Enter Remarks (Optional)"
                      rows={3}
                      value={formState.remarks}
                      onChange={(e) => setFormState(prev => ({ ...prev, remarks: e.target.value }))}
                      disabled={submitting}
                      className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs font-semibold text-slate-100 outline-none focus:border-indigo-500 transition resize-none"
                    />
                  </div>
                </div>
              </div>

              {/* SECTION 3: SUMMARY (Auto Calculated) */}
              <div className="border border-emerald-900/20 bg-emerald-950/5 rounded-2xl p-5 space-y-4 shadow-sm animate-fadeIn">
                <div className="flex items-center gap-2 border-b border-emerald-900/20 pb-2">
                  <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                  <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400 font-mono">
                    SUMMARY <span className="text-slate-500 font-medium">(Auto Calculated)</span>
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-center">
                  <div className="p-3 bg-black/40 border border-white/5 rounded-2xl">
                    <p className="text-[8px] font-bold uppercase tracking-widest text-slate-500">Total Work Order Value</p>
                    <p className="text-sm font-mono font-extrabold text-slate-100 mt-2">{formatCurrency(woValue)}</p>
                  </div>
                  <div className="p-3 bg-black/40 border border-white/5 rounded-2xl">
                    <p className="text-[8px] font-bold uppercase tracking-widest text-slate-500">Previous Bill Amount</p>
                    <p className="text-sm font-mono font-extrabold text-slate-300 mt-2">{formatCurrency(prevBilled)}</p>
                  </div>
                  <div className="p-3 bg-black/40 border border-white/5 rounded-2xl">
                    <p className="text-[8px] font-bold uppercase tracking-widest text-slate-500">Current Bill Amount</p>
                    <p className="text-sm font-mono font-extrabold text-indigo-400 mt-2">{formatCurrency(currentBilled)}</p>
                  </div>
                  <div className="p-3 bg-black/40 border border-white/5 rounded-2xl">
                    <p className="text-[8px] font-bold uppercase tracking-widest text-slate-500">Total Billed Till Date</p>
                    <p className="text-sm font-mono font-extrabold text-purple-400 mt-2">{formatCurrency(totalBilled)}</p>
                  </div>
                  <div className={`p-3 border rounded-2xl col-span-2 sm:col-span-1 ${
                    balanceRemaining < 0 
                      ? 'bg-red-950/20 border-red-900/30' 
                      : 'bg-emerald-950/20 border-emerald-900/30'
                  }`}>
                    <p className={`text-[8px] font-bold uppercase tracking-widest ${balanceRemaining < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                      Balance Amount
                    </p>
                    <p className={`text-sm font-mono font-extrabold mt-2 ${balanceRemaining < 0 ? 'text-red-400 animate-pulse' : 'text-emerald-400'}`}>
                      {formatCurrency(balanceRemaining)}
                    </p>
                  </div>
                </div>
              </div>
            </form>

            {/* Form Footer Action Buttons */}
            <div className="bg-slate-900 border-t border-white/10 p-5 shrink-0 flex flex-col gap-4">
              <div className="flex flex-row justify-end items-center gap-3">
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={submitting}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider text-red-500 bg-red-500/10 hover:bg-red-500/20 border border-red-900/20 transition flex items-center gap-1.5"
                >
                  <svg className="w-4 h-4 stroke-[2]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  CANCEL
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={submitting}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider text-amber-500 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-900/20 transition flex items-center gap-1.5"
                >
                  <svg className="w-4 h-4 stroke-[2]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 7.89H17a3 3 0 110-6h.01" />
                  </svg>
                  RESET
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting || uploading}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition shadow flex items-center gap-1.5 disabled:opacity-40"
                >
                  <svg className="w-4 h-4 stroke-[2]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                  </svg>
                  {submitting ? 'SAVING...' : 'SAVE BILL'}
                </button>
              </div>
              <div className="flex justify-between items-center text-[10px] text-slate-500 border-t border-white/5 pt-3 font-semibold">
                <span>Created By: {user?.display_name || user?.mobile_number || 'Login User'}</span>
                <span>Created Date: {currentSystemDateTime}</span>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* READ-ONLY DETAIL VIEW OVERLAY PANEL */}
      {selectedBillId && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex justify-end z-50 animate-fadeIn">
          <div className="w-full max-w-4xl bg-slate-950 border-l border-white/10 h-full flex flex-col justify-between shadow-[-10px_0_40px_rgba(0,0,0,0.8)] overflow-y-auto relative animate-slideLeft">
            
            {/* Header */}
            <div className="bg-indigo-950/20 border-b border-white/10 p-5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-indigo-500/10 border border-indigo-500/20">
                  <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h2 className="text-base font-extrabold uppercase tracking-widest text-slate-100">
                  BILL DETAILS VIEW
                </h2>
              </div>
              <button
                onClick={() => {
                  setSelectedBillId(null);
                  setDetailBill(null);
                }}
                className="text-slate-400 hover:text-slate-200 transition-colors p-1"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content Body */}
            {loadingDetail || !detailBill ? (
              <div className="flex-grow flex flex-col items-center justify-center p-8">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-indigo-500" />
                <span className="text-xs text-slate-500 mt-4 uppercase tracking-widest font-bold">Loading Details...</span>
              </div>
            ) : (
              <div className="flex-grow p-6 space-y-6 overflow-y-auto">
                {/* SECTION 1: PROJECT DETAILS */}
                <div className="border border-white/5 bg-slate-900/10 rounded-2xl p-5 space-y-4">
                  <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400 font-mono block border-b border-white/5 pb-2">
                    PROJECT DETAILS (FROZEN SNAPSHOT)
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Work Order No</p>
                      <p className="text-xs font-semibold text-slate-200 mt-0.5">{detailBill.work_order_no}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">State</p>
                      <p className="text-xs font-semibold text-slate-300 mt-0.5">{detailBill.state}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">District</p>
                      <p className="text-xs font-semibold text-slate-300 mt-0.5">{detailBill.district}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Area Code</p>
                      <p className="text-xs font-semibold text-slate-300 mt-0.5">{detailBill.area_code}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Department</p>
                      <p className="text-xs font-semibold text-slate-300 mt-0.5">{detailBill.department}</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Site Details</p>
                    <p className="text-xs font-semibold text-slate-300 mt-0.5 whitespace-pre-line">{detailBill.site_details}</p>
                  </div>
                </div>

                {/* SECTION 2: BILL DETAILS */}
                <div className="border border-white/5 bg-slate-900/10 rounded-2xl p-5 space-y-4">
                  <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400 font-mono block border-b border-white/5 pb-2">
                    BILL DETAILS
                  </span>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Type of Payment</p>
                      <p className="text-xs font-bold text-slate-200 mt-0.5">{detailBill.payment_type}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Bill Date</p>
                      <p className="text-xs font-mono font-bold text-slate-200 mt-0.5">{formatDate(detailBill.bill_date)}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Bill No</p>
                      <p className="text-xs font-semibold text-slate-200 mt-0.5">{detailBill.bill_no}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Bill Amount With GST</p>
                      <p className="text-xs font-mono font-bold text-indigo-400 mt-0.5">{formatCurrency(detailBill.bill_amount_with_gst)}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Earnest Money Deposit</p>
                      <p className="text-xs font-mono font-semibold text-slate-300 mt-0.5">{formatCurrency(detailBill.earnest_money_deposit)}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Security Deposit Amount</p>
                      <p className="text-xs font-mono font-semibold text-slate-300 mt-0.5">{formatCurrency(detailBill.security_deposit_amount)}</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Remarks</p>
                    <p className="text-xs font-semibold text-slate-300 mt-0.5 whitespace-pre-line">{detailBill.remarks || '—'}</p>
                  </div>

                  {/* Attachment View Card */}
                  <div className="border border-white/5 bg-slate-900/40 rounded-xl p-4 flex flex-col justify-between min-h-[100px] mt-4">
                    <div>
                      <p className="text-[9px] font-bold uppercase text-slate-500 tracking-wider">Bill Copy Attachment</p>
                      <p className="text-xs font-semibold text-slate-300 mt-1 truncate" title={detailBill.original_bill_filename}>
                        {detailBill.original_bill_filename || 'bill_document_copy.pdf'}
                      </p>
                    </div>
                    {detailBill.bill_copy_signed_url ? (
                      <a
                        href={detailBill.bill_copy_signed_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-center rounded-xl text-[10px] uppercase tracking-wider font-extrabold border border-indigo-500/20 transition block text-white shadow"
                      >
                        Open Bill Document Copy
                      </a>
                    ) : (
                      <span className="text-[10px] text-red-400 mt-2 font-bold">Document copy unavailable or URL expired</span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="bg-slate-900 border-t border-white/10 p-5 shrink-0 flex flex-col gap-4">
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedBillId(null);
                    setDetailBill(null);
                  }}
                  className="bg-white hover:bg-slate-100 text-slate-950 px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition"
                >
                  Close Detail Panel
                </button>
              </div>
              {detailBill && (
                <div className="flex justify-between items-center text-[10px] text-slate-500 border-t border-white/5 pt-3 font-semibold">
                  <span>Created By: {detailBill.created_by_name || detailBill.created_by}</span>
                  <span>Created At: {formatDateTime(detailBill.created_at)}</span>
                </div>
              )}
            </div>

          </div>
        </div>
      )}
    </div>
  );
};

export default RAFinalBill;
