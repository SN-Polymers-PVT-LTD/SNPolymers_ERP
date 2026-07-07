import { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '../components/AuthContext';
import BackgroundShapes from '../components/BackgroundShapes';
import Sidebar, { MobileHeader } from '../components/Sidebar';
import { Button, Input, TextArea, Select, Badge, Modal, Table, TableHeader, TableBody, TableRow, TableCell } from '../components/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  const queryClient = useQueryClient();
  
  // Tab control states: 'dashboard' or 'directory'
  const [currentTab, setCurrentTab] = useState('dashboard');
  
  // Active Project (Work Order Bill Sheet View)
  const [activeWO, setActiveWO] = useState(null); // Selected project metadata object
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Success toast popup state
  const [toast, setToast] = useState(null); // { message, billNo }

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
    gross_bill: '',
    security_deposit_amount: '',
    agency_payment: '',
    special_security_amount: '',
    other_retention: '',
    it_tds: '',
    sgst: '',
    cgst: '',
    sd: '',
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
    site_details: 'Auto',
    earnest_money_deposit: 0
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

  // In-modal form validation error (shown inside the overlay)
  const [formError, setFormError] = useState('');

  // Fetch projects using React Query
  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const res = await getProjects();
      return res.data?.projects ?? [];
    }
  });

  // Fetch paginated bills list using React Query
  const { data: billsData, isLoading: loadingBills, error: billsError } = useQuery({
    queryKey: ['bills', { page, filterWO, filterType, filterDateFrom, filterDateTo }],
    queryFn: async () => {
      const params = {
        page,
        limit: 10,
        work_order_no: filterWO || undefined,
        payment_type: filterType || undefined,
        date_from: filterDateFrom || undefined,
        date_to: filterDateTo || undefined
      };
      const res = await getBills(params);
      return res.data;
    }
  });

  // Fetch stats (all bills) using React Query
  const { data: statsBillsData } = useQuery({
    queryKey: ['bills', 'stats'],
    queryFn: async () => {
      const res = await getBills({ limit: 1000 });
      return res.data?.bills ?? [];
    }
  });

  // Fetch bills for active project timeline using React Query
  const { data: projectBillsData, isLoading: loadingProjBills } = useQuery({
    queryKey: ['bills', 'project', activeWO?.work_order_no],
    queryFn: async () => {
      const res = await getBills({ work_order_no: activeWO.work_order_no, limit: 200 });
      return (res.data?.bills ?? []).slice().reverse();
    },
    enabled: !!activeWO
  });

  // Fetch bill summary for active project using React Query
  const { data: projectSummaryResData, isLoading: loadingProjSummary } = useQuery({
    queryKey: ['billSummary', activeWO?.work_order_no],
    queryFn: async () => {
      const res = await getBillSummary(activeWO.work_order_no);
      return res.data;
    },
    enabled: !!activeWO
  });

  const projects = projectsData || [];
  const bills = billsData?.bills || [];
  const totalPages = billsData?.pagination?.totalPages || 1;
  const totalBillsCount = billsData?.pagination?.total || 0;

  const stats = useMemo(() => {
    const all = statsBillsData || [];
    const totalAmt = all.reduce((sum, b) => sum + Number(b.gross_bill || 0), 0);
    const finalCount = all.filter(b => b.payment_type === 'Final Bill').length;
    return {
      totalBills: all.length,
      totalBilledAmount: totalAmt,
      finalBillsCount: finalCount
    };
  }, [statsBillsData]);

  const projectBills = projectBillsData || [];
  const projectSummaryData = useMemo(() => {
    return {
      work_order_value: projectSummaryResData?.work_order_value || 0,
      previous_bill_amount: projectSummaryResData?.previous_bill_amount || 0,
      dropdown_options: projectSummaryResData?.dropdown_options || []
    };
  }, [projectSummaryResData]);

  const loading = loadingBills;
  const loadingProjectBills = loadingProjBills || loadingProjSummary;

  const displayError = error || billsError?.response?.data?.message || billsError?.message || '';

  // Success auto-dismiss
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(''), 5000);
    return () => clearTimeout(timer);
  }, [success]);

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  // Handle Work Order selection change (Within Create Panel)
  const handleWorkOrderChange = async (e) => {
    const wo = e.target.value;
    
    // Reset form fields dependent on WO selection
    setFormState(prev => ({
      ...prev,
      work_order_no: wo,
      payment_type: '',
      gross_bill: '',
      security_deposit_amount: '',
      agency_payment: '',
      special_security_amount: '',
      other_retention: '',
      it_tds: '',
      sgst: '',
      cgst: '',
      sd: '',
      bill_copy_url: '',
      original_bill_filename: ''
    }));

    if (!wo) {
      setFormProjectDetails({
        state: 'Auto',
        district: 'Auto',
        area_code: 'Auto',
        department: 'Auto',
        site_details: 'Auto',
        earnest_money_deposit: 0
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
      site_details: 'Loading...',
      earnest_money_deposit: 0
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
          site_details: proj.site_details,
          earnest_money_deposit: proj.earnest_money_deposit || 0
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
        
        // Also ensure formProjectDetails has EMD from live summary if not in local proj object
        setFormProjectDetails(prev => ({
          ...prev,
          earnest_money_deposit: summaryRes.data.earnest_money_deposit || 0
        }));
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

  // Helper: clamp numeric input to non-negative on change
  const handleNumericInput = (field) => (e) => {
    const raw = e.target.value;
    // Allow empty string for clearing
    if (raw === '' || raw === '-') {
      setFormState(prev => ({ ...prev, [field]: raw === '-' ? '' : raw }));
      return;
    }
    const num = parseFloat(raw);
    if (!isNaN(num) && num < 0) {
      setFormState(prev => ({ ...prev, [field]: '0' }));
    } else {
      setFormState(prev => ({ ...prev, [field]: raw }));
    }
  };

  // Form Reset
  const [_, forceUpdate] = useState(0); // Dummy for triggers
  const handleReset = () => {
    const currentWO = formState.work_order_no;
    setFormState({
      work_order_no: currentWO, // preserve WO selection
      payment_type: '',
      bill_date: '',
      bill_no: '',
      gross_bill: '',
      security_deposit_amount: '',
      agency_payment: '',
      special_security_amount: '',
      other_retention: '',
      it_tds: '',
      sgst: '',
      cgst: '',
      sd: '',
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
          setFormProjectDetails(prev => ({
            ...prev,
            earnest_money_deposit: res.data.earnest_money_deposit || 0
          }));
        }
      });
    }
  };

  // Form Cancel
  const handleCancel = () => {
    setFormError('');
    handleReset();
    setFormState({
      work_order_no: '',
      payment_type: '',
      bill_date: '',
      bill_no: '',
      gross_bill: '',
      security_deposit_amount: '',
      agency_payment: '',
      special_security_amount: '',
      other_retention: '',
      it_tds: '',
      sgst: '',
      cgst: '',
      sd: '',
      bill_copy_url: '',
      original_bill_filename: '',
      remarks: ''
    });
    setFormProjectDetails({
      state: 'Auto',
      district: 'Auto',
      area_code: 'Auto',
      department: 'Auto',
      site_details: 'Auto',
      earnest_money_deposit: 0
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
    setFormError('');
    setSuccess('');

    // 1. Required field check
    const required = ['work_order_no', 'payment_type', 'bill_date', 'bill_no', 'bill_copy_url'];
    for (const f of required) {
      if (!formState[f]) {
        setFormError(`${f.replace(/_/g, ' ')} is required. Please fill in all required fields.`);
        return;
      }
    }

    // 2. Future date check — use local-date string comparison to avoid UTC timezone parsing bug
    //    new Date("YYYY-MM-DD") is parsed as UTC midnight, which in IST (UTC+5:30) means
    //    today's date string appears "in the future" vs local midnight. String comparison is safe.
    const now = new Date();
    const todayStr = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0')
    ].join('-');
    if (formState.bill_date > todayStr) {
      setFormError('Bill Date cannot be a future date. Please enter a valid bill date.');
      return;
    }


    // 3. Negative value check for all financial fields
    const financialFields = [
      'gross_bill', 'agency_payment', 'security_deposit_amount',
      'special_security_amount', 'other_retention', 'it_tds',
      'sgst', 'cgst', 'sd'
    ];
    for (const field of financialFields) {
      const val = Number(formState[field] || 0);
      if (val < 0) {
        setFormError(`${field.replace(/_/g, ' ')} cannot be negative. All financial values must be zero or positive.`);
        return;
      }
    }

    const grossBillVal = Number(formState.gross_bill || 0);
    const breakdownSum =
      (Number(formState.agency_payment) || 0) +
      (Number(formState.security_deposit_amount) || 0) +
      (Number(formState.special_security_amount) || 0) +
      (Number(formState.other_retention) || 0) +
      (Number(formState.it_tds) || 0) +
      (Number(formState.sgst) || 0) +
      (Number(formState.cgst) || 0) +
      (Number(formState.sd) || 0);

    // 4. Gross bill vs breakdown validation (only enforce when breakdown fields are filled)
    const hasBreakdown = breakdownSum > 0;
    if (hasBreakdown && Math.abs(grossBillVal - breakdownSum) > 0.009) {
      setFormError(
        `Gross Bill (${formatCurrency(grossBillVal)}) must equal the sum of all breakdown fields (${formatCurrency(breakdownSum)}). ` +
        `Please correct the mismatch before saving.`
      );
      return;
    }

    // 5. Overbilling check: current bill + previous bills must not exceed work order value
    const workOrderValue = formSummaryData.work_order_value || 0;
    if (workOrderValue > 0) {
      const prevBilled = formSummaryData.previous_bill_amount || 0;
      const totalAfterThis = prevBilled + grossBillVal;
      if (totalAfterThis > workOrderValue) {
        setFormError(
          `This bill would cause overbilling. ` +
          `Total billed (${formatCurrency(totalAfterThis)}) would exceed the Work Order Value (${formatCurrency(workOrderValue)}). ` +
          `Maximum allowed for this bill: ${formatCurrency(workOrderValue - prevBilled)}.`
        );
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
        gross_bill: grossBillVal,
        security_deposit_amount: Number(formState.security_deposit_amount || 0),
        agency_payment: Number(formState.agency_payment || 0),
        special_security_amount: Number(formState.special_security_amount || 0),
        other_retention: Number(formState.other_retention || 0),
        it_tds: Number(formState.it_tds || 0),
        sgst: Number(formState.sgst || 0),
        cgst: Number(formState.cgst || 0),
        sd: Number(formState.sd || 0),
        bill_copy_url: formState.bill_copy_url,
        original_bill_filename: formState.original_bill_filename || null,
        remarks: formState.remarks || null
      };

      const res = await createBill(payload);
      if (res.data?.success) {
        // Invalidate & refetch BEFORE closing the modal to avoid re-render interference
        await queryClient.invalidateQueries({ queryKey: ['bills'] });
        await queryClient.invalidateQueries({ queryKey: ['billSummary'] });
        // Also explicitly refetch the stats query to ensure dashboard cards update
        queryClient.refetchQueries({ queryKey: ['bills', 'stats'] });
        // Show toast popup and close modal
        setToast({ message: 'Bill entry saved successfully!', billNo: formState.bill_no });
        handleCancel();
      }
    } catch (err) {
      console.error('Failed to save bill entry:', err);
      setFormError(err.response?.data?.message || 'Failed to submit bill entry. Please try again.');
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
  const createFormCurrentBilled = Number(formState.gross_bill) || 0;
  const createFormTotalBilled = createFormPrevBilled + createFormCurrentBilled;
  const createFormBalanceRemaining = createFormWOValue - createFormTotalBilled;

  // Live Validation: Gross Bill = sum of all deduction/payment fields
  const grossBillBreakdownSum =
    (Number(formState.agency_payment) || 0) +
    (Number(formState.security_deposit_amount) || 0) +
    (Number(formState.special_security_amount) || 0) +
    (Number(formState.other_retention) || 0) +
    (Number(formState.it_tds) || 0) +
    (Number(formState.sgst) || 0) +
    (Number(formState.cgst) || 0) +
    (Number(formState.sd) || 0);
  const grossBillEntered = Number(formState.gross_bill) || 0;
  const grossBillIsValid = grossBillEntered === grossBillBreakdownSum;
  const hasBreakdownData = grossBillEntered > 0 || grossBillBreakdownSum > 0;

  // Live Calculations for Active WO Bill Sheet Summary Panel
  const projectWOValue = projectSummaryData.work_order_value || 0;
  const projectTotalBilled = projectBills.reduce((sum, b) => sum + Number(b.gross_bill || 0), 0);
  const projectBalanceRemaining = projectWOValue - projectTotalBilled;

  // Formatting date for right footer
  const currentSystemDateTime = formatDateTime(new Date());

  return (
    <div className="h-screen bg-black text-slate-100 flex flex-col md:flex-row font-sans relative overflow-hidden">
      <BackgroundShapes />
      <Sidebar />
      <MobileHeader />

      {/* SUCCESS TOAST POPUP — fixed bottom-right, auto-dismisses */}
      {toast && (
        <div
          className="fixed bottom-6 right-6 z-[9999] animate-fadeIn"
          style={{ animation: 'slideInRight 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}
        >
          <div className="flex items-start gap-4 bg-emerald-950 border border-emerald-700/60 rounded-2xl px-5 py-4 shadow-2xl min-w-[320px] max-w-[420px]">
            <div className="shrink-0 w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mt-0.5">
              <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-extrabold text-emerald-300 tracking-tight">{toast.message}</p>
              {toast.billNo && (
                <p className="text-[11px] text-emerald-500/80 font-mono mt-0.5 truncate">Bill No: {toast.billNo}</p>
              )}
              <p className="text-[10px] text-emerald-600 mt-1 uppercase tracking-widest font-bold">Dashboard updated</p>
            </div>
            <button
              onClick={() => setToast(null)}
              className="shrink-0 text-emerald-600 hover:text-emerald-400 transition mt-0.5"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      <main className="flex-grow p-6 md:p-10 overflow-y-auto w-full relative z-10">
        {/* Status Alerts */}
        {displayError && (
          <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 mb-5 flex items-center gap-2.5 shadow-lg text-left">
            <span className="w-2 h-2 rounded-full bg-red-500 shrink-0 animate-ping" />
            {displayError}
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
                <Input label="State" disabled value={activeWO.state} size="sm" />
                <Input label="District" disabled value={activeWO.district} size="sm" />
                <Input label="Area Code (Zone)" disabled value={activeWO.zone || 'N/A'} size="sm" />
                <Input label="Department" disabled value={activeWO.department} size="sm" className="truncate" title={activeWO.department} />
                <Input label="Site Details" disabled value={activeWO.site_details} size="sm" className="truncate" title={activeWO.site_details} containerClassName="col-span-2 md:col-span-1" />
              </div>
            </div>

            {/* Bill Sheet Table Ledger */}
            <div className="glass-panel rounded-3xl border border-white/5 overflow-hidden shadow-2xl bg-gradient-to-br from-white/[0.01] to-transparent">
              <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/[0.01]">
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Bill Entries Ledger</span>
                <span className="text-[10px] font-mono font-bold text-indigo-400">Total: {projectBills.length} records</span>
              </div>

            <Table>
              <TableHeader className="bg-white/[0.02] text-slate-400">
                <TableRow hover={false} className="text-[9px]">
                  <TableCell isHeader={true} align="center" className="w-12 border-r border-white/5" size="sm">Sl No.</TableCell>
                  <TableCell isHeader={true} className="border-r border-white/5" size="sm">Payment Type</TableCell>
                  <TableCell isHeader={true} className="border-r border-white/5" size="sm">Bill Date</TableCell>
                  <TableCell isHeader={true} className="border-r border-white/5" size="sm">Bill No</TableCell>
                  <TableCell isHeader={true} align="right" className="border-r border-white/5" size="sm">Gross Bill</TableCell>
                  <TableCell isHeader={true} align="right" className="border-r border-white/5" size="sm">Agency Payment</TableCell>
                  <TableCell isHeader={true} align="right" className="border-r border-white/5" size="sm">SD Amt</TableCell>
                  <TableCell isHeader={true} className="border-r border-white/5" size="sm">Remarks</TableCell>
                  <TableCell isHeader={true} size="sm">Created At</TableCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingProjectBills ? (
                  <TableRow hover={false}>
                    <TableCell colSpan={9} align="center" className="p-8 text-slate-500 font-medium" size="sm">
                      <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-indigo-500 inline-block mb-2" />
                      <p className="text-xs uppercase tracking-widest">Loading bill entries...</p>
                    </TableCell>
                  </TableRow>
                ) : projectBills.length === 0 ? (
                  <TableRow hover={false}>
                    <TableCell colSpan={9} align="center" className="p-8 text-slate-500 font-medium italic" size="sm">
                      No bills have been submitted yet for this project.
                    </TableCell>
                  </TableRow>
                ) : (
                  projectBills.map((bill, idx) => (
                    <TableRow
                      key={bill.bill_id}
                      onClick={() => handleViewBill(bill.bill_id)}
                      interactive={true}
                      className="text-slate-300 text-left"
                    >
                      <TableCell align="center" className="font-mono font-semibold border-r border-white/5 text-slate-500" size="sm">
                        {idx + 1}
                      </TableCell>
                      <TableCell className="border-r border-white/5" size="sm">
                        <Badge variant={bill.payment_type.startsWith('RA') ? 'amber' : 'emerald'} showDot={true}>
                          {bill.payment_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono border-r border-white/5" size="sm">
                        {formatDate(bill.bill_date)}
                      </TableCell>
                      <TableCell className="border-r border-white/5 truncate max-w-[120px]" title={bill.bill_no} size="sm">
                        {bill.bill_no}
                      </TableCell>
                      <TableCell align="right" className="font-mono font-bold text-slate-200 border-r border-white/5" size="sm">
                        {formatCurrency(bill.gross_bill)}
                      </TableCell>
                      <TableCell align="right" className="font-mono text-slate-400 border-r border-white/5" size="sm">
                        {formatCurrency(bill.agency_payment)}
                      </TableCell>
                      <TableCell align="right" className="font-mono text-slate-400 border-r border-white/5" size="sm">
                        {formatCurrency(bill.security_deposit_amount)}
                      </TableCell>
                      <TableCell className="border-r border-white/5 truncate max-w-[150px]" title={bill.remarks || ''} size="sm">
                        {bill.remarks || <span className="text-slate-600 italic">None</span>}
                      </TableCell>
                      <TableCell className="font-mono text-slate-500" size="sm">
                        {formatDateTime(bill.created_at)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>

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
                    <Input
                      label="Work Order No"
                      type="text"
                      placeholder="Search WO..."
                      value={filterWO}
                      onChange={(e) => setFilterWO(e.target.value)}
                      size="sm"
                    />
                    <Select
                      label="Payment Type"
                      value={filterType}
                      onChange={(e) => setFilterType(e.target.value)}
                      size="sm"
                    >
                      <option value="">All Types</option>
                      <option value="RA Bill">RA Bills</option>
                      <option value="Final Bill">Final Bills</option>
                    </Select>
                    <Input
                      label="Date From"
                      type="date"
                      value={filterDateFrom}
                      onChange={(e) => setFilterDateFrom(e.target.value)}
                      size="sm"
                    />
                    <Input
                      label="Date To"
                      type="date"
                      value={filterDateTo}
                      onChange={(e) => setFilterDateTo(e.target.value)}
                      size="sm"
                    />
                  </div>
                  <div className="flex justify-end gap-3 mt-4 pt-4 border-t border-white/5">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setFilterWO('');
                        setFilterType('');
                        setFilterDateFrom('');
                        setFilterDateTo('');
                      }}
                      size="sm"
                    >
                      Reset Filters
                    </Button>
                    <Button
                      onClick={() => queryClient.invalidateQueries({ queryKey: ['bills'] })}
                      size="sm"
                    >
                      Apply Filter
                    </Button>
                  </div>
                </div>

                {/* Global Ledger Table */}
                <div className="glass-panel rounded-3xl border border-white/5 overflow-hidden shadow-2xl bg-gradient-to-br from-white/[0.01] to-transparent">
                  <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/[0.01]">
                    <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Ledger Feed (Global)</span>
                    <span className="text-[10px] font-mono font-bold text-indigo-400">Total: {totalBillsCount} records</span>
                  </div>

                  <Table>
                    <TableHeader className="bg-white/[0.02] text-slate-400">
                      <TableRow hover={false} className="text-[9px]">
                        <TableCell isHeader={true} align="center" className="w-12 border-r border-white/5" size="sm">Sl No.</TableCell>
                        <TableCell isHeader={true} className="border-r border-white/5" size="sm">Work Order No</TableCell>
                        <TableCell isHeader={true} className="border-r border-white/5" size="sm">Payment Type</TableCell>
                        <TableCell isHeader={true} className="border-r border-white/5" size="sm">Bill Date</TableCell>
                        <TableCell isHeader={true} className="border-r border-white/5" size="sm">Bill No</TableCell>
                        <TableCell isHeader={true} align="right" className="border-r border-white/5" size="sm">Gross Bill</TableCell>
                        <TableCell isHeader={true} className="border-r border-white/5" size="sm">Uploaded By</TableCell>
                        <TableCell isHeader={true} size="sm">Created At</TableCell>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loading ? (
                        <TableRow hover={false}>
                          <TableCell colSpan={8} align="center" className="p-8 text-slate-500 font-medium" size="sm">
                            <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-indigo-500 inline-block mb-2" />
                            <p className="text-xs uppercase tracking-widest">Loading entries...</p>
                          </TableCell>
                        </TableRow>
                      ) : bills.length === 0 ? (
                        <TableRow hover={false}>
                          <TableCell colSpan={8} align="center" className="p-8 text-slate-500 font-medium italic" size="sm">
                            No bill entries found matching the filter criteria.
                          </TableCell>
                        </TableRow>
                      ) : (
                        bills.map((bill, idx) => (
                          <TableRow
                            key={bill.bill_id}
                            onClick={() => handleViewBill(bill.bill_id)}
                            interactive={true}
                            className="text-slate-300 text-left"
                          >
                            <TableCell align="center" className="font-mono font-semibold border-r border-white/5 text-slate-500" size="sm">
                              {idx + 1 + (page - 1) * 10}
                            </TableCell>
                            <TableCell className="font-semibold border-r border-white/5 text-slate-200" size="sm">
                              {bill.work_order_no}
                            </TableCell>
                            <TableCell className="border-r border-white/5" size="sm">
                              <Badge variant={bill.payment_type.startsWith('RA') ? 'amber' : 'emerald'} showDot={true}>
                                {bill.payment_type}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-mono border-r border-white/5" size="sm">
                              {formatDate(bill.bill_date)}
                            </TableCell>
                            <TableCell className="border-r border-white/5 truncate max-w-[120px]" title={bill.bill_no} size="sm">
                              {bill.bill_no}
                            </TableCell>
                            <TableCell align="right" className="font-mono font-bold text-slate-200 border-r border-white/5" size="sm">
                              {formatCurrency(bill.gross_bill)}
                            </TableCell>
                            <TableCell className="border-r border-white/5 truncate max-w-[120px]" title={bill.created_by_name} size="sm">
                              {bill.created_by_name}
                            </TableCell>
                            <TableCell className="font-mono text-slate-500" size="sm">
                              {formatDateTime(bill.created_at)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>

                  {/* Pagination Controls */}
                  {totalPages > 1 && (
                    <div className="p-4 border-t border-white/5 bg-white/[0.01] flex justify-between items-center">
                      <Button
                        disabled={page <= 1}
                        onClick={() => setPage(p => Math.max(p - 1, 1))}
                        size="xs"
                        variant="secondary"
                      >
                        Previous
                      </Button>
                      <span className="text-xs text-slate-400">Page {page} of {totalPages}</span>
                      <Button
                        disabled={page >= totalPages}
                        onClick={() => setPage(p => Math.min(p + 1, totalPages))}
                        size="xs"
                        variant="secondary"
                      >
                        Next
                      </Button>
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
                    <Input
                      label="Work Order No"
                      type="text"
                      placeholder="Search Work Order..."
                      value={dirSearchWO}
                      onChange={(e) => setDirSearchWO(e.target.value)}
                      size="sm"
                    />
                    <Input
                      label="Department"
                      type="text"
                      placeholder="Search Department..."
                      value={dirSearchDept}
                      onChange={(e) => setDirSearchDept(e.target.value)}
                      size="sm"
                    />
                    <Input
                      label="Zone / Area"
                      type="text"
                      placeholder="Search Zone..."
                      value={dirSearchZone}
                      onChange={(e) => setDirSearchZone(e.target.value)}
                      size="sm"
                    />
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
                            <Badge variant={proj.status === 'Running' ? 'emerald' : 'slate'} showDot={false}>
                              {proj.status === 'Running' ? 'Active' : proj.status}
                            </Badge>
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
      {/* CREATE FORM OVERLAY SLIDE PANEL (No changes requested here) */}
      {showCreatePanel && (
        <Modal
          isOpen={showCreatePanel}
          onClose={handleCancel}
          title="RA / Final Bill Entry"
          subtitle={`Created By: ${user?.display_name || user?.mobile_number || 'Login User'} · ${currentSystemDateTime}`}
          size="xl"
          footer={
            <div className="flex justify-end gap-3 w-full">
              <Button
                variant="danger"
                onClick={handleCancel}
                disabled={submitting}
                icon={
                  <svg className="w-4 h-4 stroke-[2]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                }
              >
                Cancel
              </Button>
              <Button
                variant="amber"
                onClick={handleReset}
                disabled={submitting}
                icon={
                  <svg className="w-4 h-4 stroke-[2]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 7.89H17a3 3 0 110-6h.01" />
                  </svg>
                }
              >
                Reset
              </Button>
              <Button
                variant="success"
                onClick={handleSubmit}
                disabled={submitting || uploading}
                icon={
                  <svg className="w-4 h-4 stroke-[2]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                  </svg>
                }
              >
                {submitting ? 'Saving...' : 'Save Bill'}
              </Button>
            </div>
          }
        >
          {/* Form Body */}
          <div className="space-y-6 text-left">

            {/* In-Modal Validation Error Banner */}
            {formError && (
              <div className="p-4 bg-red-950/25 border border-red-700/40 rounded-2xl text-xs text-red-300 flex items-start gap-3 shadow-lg animate-fadeIn">
                <span className="mt-0.5 w-4 h-4 shrink-0 text-red-500">
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  </svg>
                </span>
                <span className="leading-relaxed font-medium">{formError}</span>
              </div>
            )}

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
                <Select
                  label="Work Order No"
                  value={formState.work_order_no}
                  onChange={handleWorkOrderChange}
                  required
                  disabled={submitting}
                >
                  <option value="">-- Select Work Order No --</option>
                  {projects.map((p) => (
                    <option key={p.work_order_no} value={p.work_order_no}>
                      {p.work_order_no}
                    </option>
                  ))}
                </Select>
                <Input label="State" disabled value={formProjectDetails.state} size="sm" />
                <Input label="District" disabled value={formProjectDetails.district} size="sm" />
                <Input label="Area Code" disabled value={formProjectDetails.area_code} size="sm" />
                <Input label="Department" disabled value={formProjectDetails.department} size="sm" />
                <Input
                  label="Earnest Money Deposit (from WO)"
                  disabled
                  value={formatCurrency(formProjectDetails.earnest_money_deposit)}
                  size="sm"
                  className="font-mono font-bold text-slate-400"
                />
              </div>

              <TextArea
                label="Site Details"
                disabled
                value={formProjectDetails.site_details}
                rows={2}
                size="sm"
              />
            </div>

            {/* SECTION 2: BILL DETAILS */}
            <div className="border border-white/5 bg-slate-900/20 rounded-2xl p-5 space-y-4 shadow-sm">
              <div className="flex items-center gap-2 border-b border-white/5 pb-2">
                <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400 font-mono">
                  BILL DETAILS
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Select
                  label="Type of Payment"
                  value={formState.payment_type}
                  onChange={(e) => setFormState(prev => ({ ...prev, payment_type: e.target.value }))}
                  required
                  disabled={!formState.work_order_no || submitting}
                  size="sm"
                >
                  <option value="">
                    {!formState.work_order_no ? '-- Select Work Order First --' : '-- Select Type of Payment --'}
                  </option>
                  {formSummaryData.dropdown_options.map((opt) => (
                    <option key={opt.value} value={opt.value} disabled={!opt.available}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
                <Input
                  label="Bill Date"
                  type="date"
                  value={formState.bill_date}
                  onChange={(e) => setFormState(prev => ({ ...prev, bill_date: e.target.value }))}
                  required
                  disabled={submitting}
                  size="sm"
                  className="font-mono"
                />
                <Input
                  label="Bill No"
                  type="text"
                  placeholder="Enter Bill No"
                  value={formState.bill_no}
                  onChange={(e) => setFormState(prev => ({ ...prev, bill_no: e.target.value }))}
                  required
                  disabled={submitting}
                  size="sm"
                />

                {/* File Upload Component */}
                <div className="flex flex-col">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                    Upload Bill Copy <span className="text-red-400">*</span>
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
                      <Button
                        variant="glass"
                        onClick={() => fileInputRef.current?.click()}
                        size="sm"
                      >
                        Choose File
                      </Button>
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

                <TextArea
                  label="Remarks"
                  placeholder="Enter Remarks (Optional)"
                  rows={3}
                  value={formState.remarks}
                  onChange={(e) => setFormState(prev => ({ ...prev, remarks: e.target.value }))}
                  disabled={submitting}
                  size="sm"
                  className="col-span-1"
                />
              </div>
            </div>

            {/* SECTION 2b: PAYMENT BREAKDOWN */}
            <div className="border border-white/5 bg-slate-900/20 rounded-2xl p-5 space-y-4 shadow-sm">
              <div className="flex items-center gap-2 border-b border-white/5 pb-2">
                <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                <span className="text-[10px] font-black uppercase tracking-widest text-amber-400 font-mono">
                  PAYMENT BREAKDOWN <span className="text-slate-500 font-medium">(All fields optional — blank = 0)</span>
                </span>
              </div>

              {/* Field 1: Gross Bill — highlighted */}
              <div className="p-3 rounded-xl bg-amber-950/10 border border-amber-900/25">
                <Input
                  label="Gross Bill (Field 1)"
                  type="number"
                  placeholder="Enter Gross Bill Amount"
                  step="0.01"
                  min="0"
                  value={formState.gross_bill}
                  onChange={handleNumericInput('gross_bill')}
                  disabled={submitting}
                  size="sm"
                  iconLeft={<span className="text-xs text-amber-500 font-bold">₹</span>}
                  className="font-mono font-bold"
                />
              </div>

              {/* Fields 2–9: Breakdown deduction/payment fields */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Input
                  label="Agency Payment"
                  type="number" placeholder="0.00" step="0.01" min="0"
                  value={formState.agency_payment}
                  onChange={handleNumericInput('agency_payment')}
                  disabled={submitting} size="sm"
                  iconLeft={<span className="text-xs text-slate-500 font-bold">₹</span>}
                  className="font-mono"
                />
                <Input
                  label="Security Deposit Amt"
                  type="number" placeholder="0.00" step="0.01" min="0"
                  value={formState.security_deposit_amount}
                  onChange={handleNumericInput('security_deposit_amount')}
                  disabled={submitting} size="sm"
                  iconLeft={<span className="text-xs text-slate-500 font-bold">₹</span>}
                  className="font-mono"
                />
                <Input
                  label="Special Security Amt"
                  type="number" placeholder="0.00" step="0.01" min="0"
                  value={formState.special_security_amount}
                  onChange={handleNumericInput('special_security_amount')}
                  disabled={submitting} size="sm"
                  iconLeft={<span className="text-xs text-slate-500 font-bold">₹</span>}
                  className="font-mono"
                />
                <Input
                  label="Other Retention"
                  type="number" placeholder="0.00" step="0.01" min="0"
                  value={formState.other_retention}
                  onChange={handleNumericInput('other_retention')}
                  disabled={submitting} size="sm"
                  iconLeft={<span className="text-xs text-slate-500 font-bold">₹</span>}
                  className="font-mono"
                />
                <Input
                  label="IT TDS"
                  type="number" placeholder="0.00" step="0.01" min="0"
                  value={formState.it_tds}
                  onChange={handleNumericInput('it_tds')}
                  disabled={submitting} size="sm"
                  iconLeft={<span className="text-xs text-slate-500 font-bold">₹</span>}
                  className="font-mono"
                />
                <Input
                  label="SGST"
                  type="number" placeholder="0.00" step="0.01" min="0"
                  value={formState.sgst}
                  onChange={handleNumericInput('sgst')}
                  disabled={submitting} size="sm"
                  iconLeft={<span className="text-xs text-slate-500 font-bold">₹</span>}
                  className="font-mono"
                />
                <Input
                  label="CGST"
                  type="number" placeholder="0.00" step="0.01" min="0"
                  value={formState.cgst}
                  onChange={handleNumericInput('cgst')}
                  disabled={submitting} size="sm"
                  iconLeft={<span className="text-xs text-slate-500 font-bold">₹</span>}
                  className="font-mono"
                />
                <Input
                  label="SD"
                  type="number" placeholder="0.00" step="0.01" min="0"
                  value={formState.sd}
                  onChange={handleNumericInput('sd')}
                  disabled={submitting} size="sm"
                  iconLeft={<span className="text-xs text-slate-500 font-bold">₹</span>}
                  className="font-mono"
                />
              </div>

              {/* Live Validation Banner */}
              {hasBreakdownData && (
                <div className={`rounded-xl p-4 border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 transition-all ${
                  grossBillIsValid
                    ? 'bg-emerald-950/15 border-emerald-900/30'
                    : 'bg-red-950/15 border-red-900/30'
                }`}>
                  <div className="flex flex-col gap-1">
                    <span className="text-[9px] font-extrabold uppercase tracking-widest text-slate-500">Validation: Gross Bill = Sum of Breakdown Fields</span>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-[10px] font-mono">
                      <span className="text-slate-400">Gross Bill Entered: <span className="font-bold text-slate-200">{formatCurrency(grossBillEntered)}</span></span>
                      <span className="text-slate-400">Breakdown Sum: <span className="font-bold text-slate-200">{formatCurrency(grossBillBreakdownSum)}</span></span>
                    </div>
                  </div>
                  <div className={`shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-extrabold uppercase tracking-wider ${
                    grossBillIsValid
                      ? 'bg-emerald-950/30 text-emerald-400'
                      : 'bg-red-950/30 text-red-400'
                  }`}>
                    {grossBillIsValid ? (
                      <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg> Match</>
                    ) : (
                      <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg> Mismatch</>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* SECTION 3: SUMMARY (Auto Calculated) */}
            <div className="border border-emerald-900/20 bg-emerald-950/5 rounded-2xl p-5 space-y-4 shadow-sm">
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

          </div>
        </Modal>
      )}

      {/* READ-ONLY DETAIL VIEW OVERLAY PANEL */}
      {selectedBillId && (
        <Modal
          isOpen={!!selectedBillId}
          onClose={() => {
            setSelectedBillId(null);
            setDetailBill(null);
          }}
          title="Bill Details View"
          subtitle={detailBill ? `Created By: ${detailBill.created_by_name || detailBill.created_by} · ${formatDateTime(detailBill.created_at)}` : ''}
          size="lg"
          footer={
            <div className="flex justify-end w-full">
              <Button
                variant="glass"
                onClick={() => {
                  setSelectedBillId(null);
                  setDetailBill(null);
                }}
              >
                Close Details
              </Button>
            </div>
          }
        >
          {loadingDetail || !detailBill ? (
            <div className="py-12 flex flex-col items-center justify-center text-slate-500 text-xs font-bold uppercase tracking-widest">
              <span className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-indigo-500 mb-2" />
              Loading Details...
            </div>
          ) : (
            <div className="space-y-6 text-left text-xs">
              {/* SECTION 1: PROJECT DETAILS */}
              <div className="border border-white/5 bg-slate-900/10 rounded-2xl p-5 space-y-4">
                <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400 font-mono block border-b border-white/5 pb-2">
                  PROJECT DETAILS (FROZEN SNAPSHOT)
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <Input label="Work Order No" disabled value={detailBill.work_order_no} size="sm" />
                  <Input label="State" disabled value={detailBill.state} size="sm" />
                  <Input label="District" disabled value={detailBill.district} size="sm" />
                  <Input label="Area Code" disabled value={detailBill.area_code} size="sm" />
                  <Input label="Department" disabled value={detailBill.department} size="sm" />
                </div>
                <TextArea
                  label="Site Details"
                  disabled
                  value={detailBill.site_details}
                  rows={2}
                  size="sm"
                />
              </div>

              {/* SECTION 2: BILL DETAILS */}
              <div className="border border-white/5 bg-slate-900/10 rounded-2xl p-5 space-y-4">
                <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400 font-mono block border-b border-white/5 pb-2">
                  BILL DETAILS
                </span>
                <div className="grid grid-cols-2 gap-4">
                  <Input label="Type of Payment" disabled value={detailBill.payment_type} size="sm" />
                  <Input label="Bill Date" disabled value={formatDate(detailBill.bill_date)} size="sm" className="font-mono" />
                  <Input label="Bill No" disabled value={detailBill.bill_no} size="sm" />
                  <Input
                    label="Gross Bill"
                    disabled
                    value={formatCurrency(detailBill.gross_bill)}
                    size="sm"
                    className="font-mono font-bold text-amber-400"
                  />
                </div>

                {/* Payment Breakdown — read-only */}
                <div className="border border-amber-900/20 bg-amber-950/5 rounded-xl p-4 space-y-3 mt-2">
                  <span className="text-[9px] font-extrabold uppercase tracking-widest text-amber-400 font-mono block">Payment Breakdown</span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <Input label="Agency Payment" disabled value={formatCurrency(detailBill.agency_payment)} size="sm" className="font-mono" />
                    <Input label="Security Deposit Amt" disabled value={formatCurrency(detailBill.security_deposit_amount)} size="sm" className="font-mono" />
                    <Input label="Special Security Amt" disabled value={formatCurrency(detailBill.special_security_amount)} size="sm" className="font-mono" />
                    <Input label="Other Retention" disabled value={formatCurrency(detailBill.other_retention)} size="sm" className="font-mono" />
                    <Input label="IT TDS" disabled value={formatCurrency(detailBill.it_tds)} size="sm" className="font-mono" />
                    <Input label="SGST" disabled value={formatCurrency(detailBill.sgst)} size="sm" className="font-mono" />
                    <Input label="CGST" disabled value={formatCurrency(detailBill.cgst)} size="sm" className="font-mono" />
                    <Input label="SD" disabled value={formatCurrency(detailBill.sd)} size="sm" className="font-mono" />
                  </div>
                </div>
                <TextArea
                  label="Remarks"
                  disabled
                  value={detailBill.remarks || '—'}
                  rows={2}
                  size="sm"
                />

                {/* Attachment View Card */}
                <div className="border border-white/5 bg-slate-900/40 rounded-xl p-4 flex flex-col justify-between min-h-[100px] mt-4">
                  <div>
                    <p className="text-[9px] font-bold uppercase text-slate-500 tracking-wider">Bill Copy Attachment</p>
                    <p className="text-xs font-semibold text-slate-300 mt-1 truncate" title={detailBill.original_bill_filename}>
                      {detailBill.original_bill_filename || 'bill_document_copy.pdf'}
                    </p>
                  </div>
                  {detailBill.bill_copy_signed_url ? (
                    <Button
                      variant="primary"
                      onClick={() => window.open(detailBill.bill_copy_signed_url, '_blank')}
                      size="sm"
                      className="mt-3"
                    >
                      Open Bill Document Copy
                    </Button>
                  ) : (
                    <span className="text-[10px] text-red-400 mt-2 font-bold">Document copy unavailable or URL expired</span>
                  )}
                </div>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
};

export default RAFinalBill;
