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
  
  // Tab control states: 'dashboard' or 'directory'
  const [currentTab, setCurrentTab] = useState('dashboard');
  
  // Active Project (Work Order Bill Sheet View)
  const [activeWO, setActiveWO] = useState(null); // Selected project metadata object
  const [projectBills, setProjectBills] = useState([]); // Bills list for the selected project
  const [loadingProjectBills, setLoadingProjectBills] = useState(false);
  const [projectSummaryData, setProjectSummaryData] = useState({
    work_order_value: 0,
    previous_bill_amount: 0,
    dropdown_options: []
  });

  // Master lists
  const [bills, setBills] = useState([]); // Global bills for overview dashboard
  const [projects, setProjects] = useState([]); // Directory projects list
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // UI Panels
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [selectedBillId, setSelectedBillId] = useState(null);
  const [detailBill, setDetailBill] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Search/Filter states for Global Overview Feed
  const [filterWO, setFilterWO] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalBillsCount, setTotalBillsCount] = useState(0);

  // Directory Search Filters
  const [dirSearchWO, setDirSearchWO] = useState('');
  const [dirSearchDept, setDirSearchDept] = useState('');
  const [dirSearchZone, setDirSearchZone] = useState('');

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

  // Project auto-fetched states for the form
  const [formProjectDetails, setFormProjectDetails] = useState({
    state: 'Auto',
    district: 'Auto',
    area_code: 'Auto',
    department: 'Auto',
    site_details: 'Auto'
  });

  // Summary options specifically for the active form instance
  const [formSummaryData, setFormSummaryData] = useState({
    work_order_value: 0,
    previous_bill_amount: 0,
    dropdown_options: []
  });

  // Upload States
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef(null);

  // Overall Stats
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

  // Fetch projects directory and global summary stats
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

  // Fetch reports specifically for an active project timeline (spreadsheet representation)
  const fetchProjectBillSheet = useCallback(async (workOrderNo) => {
    setLoadingProjectBills(true);
    try {
      // 1. Fetch bills filtered for this work order
      const billsRes = await getBills({ work_order_no: workOrderNo, limit: 200 });
      if (billsRes.data?.success) {
        // Sort chronologically ascending (earliest first, latest at bottom)
        const sortedAsc = (billsRes.data.bills ?? []).slice().reverse();
        setProjectBills(sortedAsc);
      }

      // 2. Fetch live metrics
      const summaryRes = await getBillSummary(workOrderNo);
      if (summaryRes.data?.success) {
        setProjectSummaryData({
          work_order_value: summaryRes.data.work_order_value,
          previous_bill_amount: summaryRes.data.previous_bill_amount,
          dropdown_options: summaryRes.data.dropdown_options
        });
      }
    } catch (err) {
      console.error('Failed to retrieve project bill sheet:', err);
      setError('Failed to retrieve project bill ledger.');
    } finally {
      setLoadingProjectBills(false);
    }
  }, []);

  useEffect(() => {
    fetchBillsList();
  }, [fetchBillsList]);

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  useEffect(() => {
    if (activeWO) {
      fetchProjectBillSheet(activeWO.work_order_no);
    }
  }, [activeWO, fetchProjectBillSheet]);

  // Handle Work Order selection change (Within Create Panel)
  const handleWorkOrderChange = async (e) => {
    const wo = e.target.value;
    
    // Reset form fields dependent on WO selection
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
      setFormProjectDetails({
        state: 'Auto',
        district: 'Auto',
        area_code: 'Auto',
        department: 'Auto',
        site_details: 'Auto'
      });
      setFormSummaryData({
        work_order_value: 0,
        previous_bill_amount: 0,
        dropdown_options: []
      });
      return;
    }

    // Set temporary loading states
    setFormProjectDetails({
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
        setFormProjectDetails({
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
        setFormSummaryData({
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
          setFormSummaryData({
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
    setFormProjectDetails({
      state: 'Auto',
      district: 'Auto',
      area_code: 'Auto',
      department: 'Auto',
      site_details: 'Auto'
    });
    setFormSummaryData({
      work_order_value: 0,
      previous_bill_amount: 0,
      dropdown_options: []
    });
    setShowCreatePanel(false);
  };

  // Form Submit
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
        
        // Refresh appropriate tables
        fetchBillsList();
        fetchInitialData();
        if (activeWO) {
          fetchProjectBillSheet(activeWO.work_order_no);
        }
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

  // Open the create panel pre-populated with a specific work order
  const handleOpenCreatePanelForWO = async (workOrderNo) => {
    setShowCreatePanel(true);
    
    // Simulate Work Order change programmatically to fetch and auto-fill details
    const e = { target: { value: workOrderNo } };
    handleWorkOrderChange(e);
  };

  // Filtering projects list for the directory
  const filteredProjects = projects.filter(proj => {
    const matchWO = !dirSearchWO || proj.work_order_no.toLowerCase().includes(dirSearchWO.toLowerCase());
    const matchDept = !dirSearchDept || proj.department.toLowerCase().includes(dirSearchDept.toLowerCase());
    const matchZone = !dirSearchZone || (proj.zone && proj.zone.toLowerCase().includes(dirSearchZone.toLowerCase()));
    return matchWO && matchDept && matchZone;
  });

  // Live Calculations for Create Form Summary Panel
  const createFormWOValue = formSummaryData.work_order_value || 0;
  const createFormPrevBilled = formSummaryData.previous_bill_amount || 0;
  const createFormCurrentBilled = Number(formState.bill_amount_with_gst) || 0;
  const createFormTotalBilled = createFormPrevBilled + createFormCurrentBilled;
  const createFormBalanceRemaining = createFormWOValue - createFormTotalBilled;

  // Live Calculations for Active WO Bill Sheet Summary Panel
  const projectWOValue = projectSummaryData.work_order_value || 0;
  const projectTotalBilled = projectBills.reduce((sum, b) => sum + Number(b.bill_amount_with_gst || 0), 0);
  const projectBalanceRemaining = projectWOValue - projectTotalBilled;

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

        {/* SECTION A: INDIVIDUAL WORK ORDER BILL SHEET */}
        {activeWO ? (
          <div className="space-y-6 animate-fadeIn">
            {/* Header Block with Back navigation */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-6 border-b border-white/5">
              <div>
                <button
                  onClick={() => setActiveWO(null)}
                  className="flex items-center gap-2 text-xs font-bold text-indigo-400 hover:text-indigo-300 uppercase tracking-wider transition mb-2"
                >
                  &larr; Back to Directory
                </button>
                <h1 className="text-2xl font-black tracking-tight text-slate-100">
                  Bill Sheet: {activeWO.work_order_no}
                </h1>
                <p className="text-xs text-slate-400 font-medium mt-1">
                  Chronological billing entries, deduction snapshots, and PDF copies ledger.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => handleOpenCreatePanelForWO(activeWO.work_order_no)}
                  className="bg-white hover:bg-slate-100 text-slate-950 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition shadow flex items-center gap-2"
                >
                  <svg className="w-4 h-4 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  New Bill Entry
                </button>
              </div>
            </div>

            {/* Geographical snapshots summary */}
            <div className="glass-panel p-5 rounded-3xl border border-white/5">
              <span className="text-[9px] uppercase font-black tracking-widest text-indigo-400 font-mono block mb-3">Project Metadata Snapshots</span>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div>
                  <label className="block text-[9px] font-extrabold text-slate-500 uppercase tracking-widest mb-1">State</label>
                  <input type="text" disabled value={activeWO.state} className="w-full bg-white/[0.02] border border-white/5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-400 cursor-not-allowed" />
                </div>
                <div>
                  <label className="block text-[9px] font-extrabold text-slate-500 uppercase tracking-widest mb-1">District</label>
                  <input type="text" disabled value={activeWO.district} className="w-full bg-white/[0.02] border border-white/5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-400 cursor-not-allowed" />
                </div>
                <div>
                  <label className="block text-[9px] font-extrabold text-slate-500 uppercase tracking-widest mb-1">Area Code (Zone)</label>
                  <input type="text" disabled value={activeWO.zone || 'N/A'} className="w-full bg-white/[0.02] border border-white/5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-400 cursor-not-allowed" />
                </div>
                <div>
                  <label className="block text-[9px] font-extrabold text-slate-500 uppercase tracking-widest mb-1">Department</label>
                  <input type="text" disabled value={activeWO.department} className="w-full bg-white/[0.02] border border-white/5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-400 cursor-not-allowed truncate" title={activeWO.department} />
                </div>
                <div className="col-span-2 md:col-span-1">
                  <label className="block text-[9px] font-extrabold text-slate-500 uppercase tracking-widest mb-1">Site Details</label>
                  <input type="text" disabled value={activeWO.site_details} className="w-full bg-white/[0.02] border border-white/5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-400 cursor-not-allowed truncate" title={activeWO.site_details} />
                </div>
              </div>
            </div>

            {/* Bill Sheet Table Ledger */}
            <div className="glass-panel rounded-3xl border border-white/5 overflow-hidden shadow-2xl bg-gradient-to-br from-white/[0.01] to-transparent">
              <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/[0.01]">
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Bill Entries Ledger</span>
                <span className="text-[10px] font-mono font-bold text-indigo-400">Total: {projectBills.length} records</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-white/5 text-[9px] uppercase font-bold tracking-widest text-slate-400 bg-white/[0.02]">
                      <th className="p-3 text-center w-12 border-r border-white/5">Sl No.</th>
                      <th className="p-3 border-r border-white/5">Payment Type</th>
                      <th className="p-3 border-r border-white/5">Bill Date</th>
                      <th className="p-3 border-r border-white/5">Bill No</th>
                      <th className="p-3 text-right border-r border-white/5">Bill Amount (GST)</th>
                      <th className="p-3 text-right border-r border-white/5">EMD Amount</th>
                      <th className="p-3 text-right border-r border-white/5">SD Amount</th>
                      <th className="p-3 border-r border-white/5">Remarks</th>
                      <th className="p-3">Created At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {loadingProjectBills ? (
                      <tr>
                        <td colSpan="9" className="p-8 text-center text-slate-500 font-medium">
                          <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-indigo-500 inline-block mb-2" />
                          <p className="text-xs uppercase tracking-widest">Loading bill entries...</p>
                        </td>
                      </tr>
                    ) : projectBills.length === 0 ? (
                      <tr>
                        <td colSpan="9" className="p-8 text-center text-slate-500 font-medium italic">
                          No bills have been submitted yet for this project.
                        </td>
                      </tr>
                    ) : (
                      projectBills.map((bill, idx) => (
                        <tr
                          key={bill.bill_id}
                          onClick={() => handleViewBill(bill.bill_id)}
                          className="hover:bg-white/[0.02] cursor-pointer transition duration-150 text-slate-300"
                        >
                          <td className="p-3 text-center font-mono font-semibold border-r border-white/5 text-slate-500">
                            {idx + 1}
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
                          <td className="p-3 text-right font-mono text-slate-400 border-r border-white/5">
                            {formatCurrency(bill.earnest_money_deposit)}
                          </td>
                          <td className="p-3 text-right font-mono text-slate-400 border-r border-white/5">
                            {formatCurrency(bill.security_deposit_amount)}
                          </td>
                          <td className="p-3 border-r border-white/5 truncate max-w-[150px]" title={bill.remarks || ''}>
                            {bill.remarks || <span className="text-slate-600 italic">None</span>}
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

              {/* Aggregated spreadsheet summary metrics */}
              <div className="p-4 border-t border-white/5 bg-emerald-950/5 border-l border-r border-b rounded-b-3xl">
                <span className="text-[9px] uppercase font-black tracking-widest text-emerald-400 font-mono">Ledger Aggregated Summary Metrics</span>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-2">
                  <div className="p-3 rounded-2xl bg-black/40 border border-white/5 text-center">
                    <p className="text-[8px] font-bold uppercase tracking-widest text-slate-500">Total Work Order Value</p>
                    <p className="text-sm font-mono font-extrabold text-slate-100 mt-2">{formatCurrency(projectWOValue)}</p>
                  </div>
                  <div className="p-3 rounded-2xl bg-black/40 border border-white/5 text-center">
                    <p className="text-[8px] font-bold uppercase tracking-widest text-slate-500">Cumulative Billed Amount</p>
                    <p className="text-sm font-mono font-extrabold text-indigo-400 mt-2">{formatCurrency(projectTotalBilled)}</p>
                  </div>
                  <div className={`p-3 rounded-2xl border text-center ${
                    projectBalanceRemaining < 0 
                      ? 'bg-red-950/20 border-red-900/30' 
                      : 'bg-emerald-950/20 border-emerald-900/30'
                  }`}>
                    <p className={`text-[8px] font-bold uppercase tracking-widest ${projectBalanceRemaining < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                      Balance Amount Remaining
                    </p>
                    <p className={`text-sm font-mono font-extrabold mt-2 ${projectBalanceRemaining < 0 ? 'text-red-400 animate-pulse' : 'text-emerald-400'}`}>
                      {formatCurrency(projectBalanceRemaining)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* SECTION B: PRIMARY DASHBOARD CONTROLLER (Overview & Directory Tabs) */
          <div className="space-y-6 animate-fadeIn">
            {/* Header section with Tab selector */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 pb-6 border-b border-white/5">
              <div>
                <span className="text-[10px] uppercase font-bold tracking-widest text-indigo-400 font-mono">
                  Finance & Billing Console
                </span>
                <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">RA / Final Bill Entry</h1>
                <p className="text-xs text-slate-400 font-medium mt-1.5">
                  Record running accounts, submit final settlement audits, and track balances.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center w-full md:w-auto">
                {/* Navigation Tab Switcher */}
                <div className="flex bg-white/5 p-1 rounded-2xl border border-white/5 shrink-0 self-stretch sm:self-auto">
                  <button
                    onClick={() => setCurrentTab('dashboard')}
                    className={`flex-grow sm:flex-none px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition ${
                      currentTab === 'dashboard'
                        ? 'bg-white text-slate-950 shadow-md'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Overview Dashboard
                  </button>
                  <button
                    onClick={() => setCurrentTab('directory')}
                    className={`flex-grow sm:flex-none px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition ${
                      currentTab === 'directory'
                        ? 'bg-white text-slate-950 shadow-md'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Projects Directory
                  </button>
                </div>

                <button
                  onClick={() => setShowCreatePanel(true)}
                  className="bg-white hover:bg-slate-100 text-slate-950 px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition shadow flex items-center justify-center gap-2 shrink-0"
                >
                  <svg className="w-4 h-4 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  New Bill Entry
                </button>
              </div>
            </div>

            {/* TAB 1: OVERVIEW DASHBOARD */}
            {currentTab === 'dashboard' && (
              <div className="space-y-6 animate-fadeIn">
                {/* Stats Cards Row */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
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
                <div className="glass-panel p-5 rounded-3xl border border-white/5">
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

                {/* Global Ledger Table */}
                <div className="glass-panel rounded-3xl border border-white/5 overflow-hidden shadow-2xl bg-gradient-to-br from-white/[0.01] to-transparent">
                  <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/[0.01]">
                    <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Ledger Ledger Ledger Feed (Global)</span>
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
              </div>
            )}

            {/* TAB 2: PROJECTS DIRECTORY */}
            {currentTab === 'directory' && (
              <div className="space-y-6 animate-fadeIn">
                {/* Search Bar for Directory */}
                <div className="glass-panel p-5 rounded-3xl border border-white/5">
                  <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 block mb-3">Filter Directory Projects</span>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-[9px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">Work Order No</label>
                      <input
                        type="text"
                        placeholder="Search Work Order..."
                        value={dirSearchWO}
                        onChange={(e) => setDirSearchWO(e.target.value)}
                        className="w-full bg-white/5 border border-white/5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-200 outline-none focus:border-indigo-500 transition"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">Department</label>
                      <input
                        type="text"
                        placeholder="Search Department..."
                        value={dirSearchDept}
                        onChange={(e) => setDirSearchDept(e.target.value)}
                        className="w-full bg-white/5 border border-white/5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-200 outline-none focus:border-indigo-500 transition"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">Zone / Area</label>
                      <input
                        type="text"
                        placeholder="Search Zone..."
                        value={dirSearchZone}
                        onChange={(e) => setDirSearchZone(e.target.value)}
                        className="w-full bg-white/5 border border-white/5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-200 outline-none focus:border-indigo-500 transition"
                      />
                    </div>
                  </div>
                </div>

                {/* Projects Grid List */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredProjects.length === 0 ? (
                    <div className="col-span-full p-10 text-center text-slate-500 font-medium italic glass-panel rounded-3xl">
                      No projects matched your search criteria.
                    </div>
                  ) : (
                    filteredProjects.map((proj) => (
                      <div
                        key={proj.work_order_no}
                        onClick={() => setActiveWO(proj)}
                        className="glass-panel glass-card-hover p-6 rounded-3xl border border-white/5 cursor-pointer relative overflow-hidden flex flex-col justify-between min-h-[200px]"
                      >
                        <div>
                          <div className="flex justify-between items-start mb-3">
                            <span className="text-[9px] font-bold uppercase tracking-widest text-indigo-400 font-mono truncate max-w-[200px]" title={proj.department}>
                              {proj.department}
                            </span>
                            <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${
                              proj.status === 'Running' 
                                ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' 
                                : 'bg-slate-500/10 border border-slate-500/20 text-slate-400'
                            }`}>
                              {proj.status}
                            </span>
                          </div>
                          
                          <h3 className="text-sm font-extrabold text-slate-200 font-mono" title={proj.work_order_no}>
                            {proj.work_order_no}
                          </h3>
                          <p className="text-xs text-slate-400 mt-2 truncate-2-lines min-h-[32px]">
                            {proj.site_details}
                          </p>
                        </div>

                        <div className="border-t border-white/5 pt-4 mt-4 flex items-center justify-between">
                          <div className="flex flex-col">
                            <span className="text-[8px] uppercase tracking-widest text-slate-500">Geography</span>
                            <span className="text-xs text-slate-300 font-semibold mt-0.5">{proj.state} / {proj.district}</span>
                          </div>
                          <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest group-hover:translate-x-1 transition duration-200">
                            Open Sheet &rarr;
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* CREATE FORM OVERLAY SLIDE PANEL (No changes requested here) */}
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
                      value={formProjectDetails.state}
                      className="w-full bg-white/[0.02] border border-white/5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-500 cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-extrabold text-slate-400 uppercase tracking-widest mb-1.5">District</label>
                    <input
                      type="text"
                      disabled
                      value={formProjectDetails.district}
                      className="w-full bg-white/[0.02] border border-white/5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-500 cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-extrabold text-slate-400 uppercase tracking-widest mb-1.5">Area Code</label>
                    <input
                      type="text"
                      disabled
                      value={formProjectDetails.area_code}
                      className="w-full bg-white/[0.02] border border-white/5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-500 cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-extrabold text-slate-400 uppercase tracking-widest mb-1.5">Department</label>
                    <input
                      type="text"
                      disabled
                      value={formProjectDetails.department}
                      className="w-full bg-white/[0.02] border border-white/5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-500 cursor-not-allowed"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[9px] font-extrabold text-slate-400 uppercase tracking-widest mb-1.5">Site Details</label>
                  <textarea
                    disabled
                    value={formProjectDetails.site_details}
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
                      {formSummaryData.dropdown_options.map((opt) => (
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
                    <p className="text-sm font-mono font-extrabold text-slate-100 mt-2">{formatCurrency(createFormWOValue)}</p>
                  </div>
                  <div className="p-3 bg-black/40 border border-white/5 rounded-2xl">
                    <p className="text-[8px] font-bold uppercase tracking-widest text-slate-500">Previous Bill Amount</p>
                    <p className="text-sm font-mono font-extrabold text-slate-300 mt-2">{formatCurrency(createFormPrevBilled)}</p>
                  </div>
                  <div className="p-3 bg-black/40 border border-white/5 rounded-2xl">
                    <p className="text-[8px] font-bold uppercase tracking-widest text-slate-500">Current Bill Amount</p>
                    <p className="text-sm font-mono font-extrabold text-indigo-400 mt-2">{formatCurrency(createFormCurrentBilled)}</p>
                  </div>
                  <div className="p-3 bg-black/40 border border-white/5 rounded-2xl">
                    <p className="text-[8px] font-bold uppercase tracking-widest text-slate-500">Total Billed Till Date</p>
                    <p className="text-sm font-mono font-extrabold text-purple-400 mt-2">{formatCurrency(createFormTotalBilled)}</p>
                  </div>
                  <div className={`p-3 border rounded-2xl col-span-2 sm:col-span-1 ${
                    createFormBalanceRemaining < 0 
                      ? 'bg-red-950/20 border-red-900/30' 
                      : 'bg-emerald-950/20 border-emerald-900/30'
                  }`}>
                    <p className={`text-[8px] font-bold uppercase tracking-widest ${createFormBalanceRemaining < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                      Balance Amount
                    </p>
                    <p className={`text-sm font-mono font-extrabold mt-2 ${createFormBalanceRemaining < 0 ? 'text-red-400 animate-pulse' : 'text-emerald-400'}`}>
                      {formatCurrency(createFormBalanceRemaining)}
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
