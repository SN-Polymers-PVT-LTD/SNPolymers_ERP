import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../components/AuthContext';
import authApi from '../api/authApi';
import BackgroundShapes from '../components/BackgroundShapes';
import Sidebar, { MobileHeader } from '../components/Sidebar';
import TopNavbar from '../components/TopNavbar';
import { Button, Input, TextArea, Badge, Modal, Table, TableHeader, TableBody, TableRow, TableCell } from '../components/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';

// API Clients
import { getProjects } from '../api/projectsApi';
import {
  createProgressReport,
  getProgressReports,
  getProgressReportById,
  addAuthorityRemarks,
  uploadSitePhoto
} from '../api/dailyProgressApi';

const DailyProgress = () => {
  const { user } = useAuth();
  
  // Tab control states: 'dashboard' or 'directory'
  const [currentTab, setCurrentTab] = useState('dashboard');
  const [activeWO, setActiveWO] = useState(null); // Selected project object (for spreadsheet view)
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const queryClient = useQueryClient();

  // Page layout toggles
  const [showCreateFlow, setShowCreateFlow] = useState(false);
  const [activeReport, setActiveReport] = useState(null); // Detail modal target
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);

  // Form states for appending a new log entry
  const [siteVisitDate, setSiteVisitDate] = useState('');
  const [workProgressDetails, setWorkProgressDetails] = useState('');
  const [physicalWorkProgress, setPhysicalWorkProgress] = useState('');
  const [remarksAfterSiteVisit, setRemarksAfterSiteVisit] = useState('');

  // Back-dated entry modal states
  const [showBackDateModal, setShowBackDateModal] = useState(false);
  const [backDateReason, setBackDateReason] = useState('');
  const [pendingBackDateVal, setPendingBackDateVal] = useState('');

  const handleConfirmBackDate = () => {
    if (backDateReason.trim()) {
      setSiteVisitDate(pendingBackDateVal);
      setRemarksAfterSiteVisit(backDateReason.trim());
      setShowBackDateModal(false);
    }
  };

  const handleCancelBackDate = () => {
    setSiteVisitDate('');
    setShowBackDateModal(false);
  };

  const isSelectedDateBackdated = (() => {
    if (!siteVisitDate) return false;
    const [year, month, day] = siteVisitDate.split('-').map(Number);
    const inputDate = new Date(year, month - 1, day);
    
    const options = { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' };
    const formatter = new Intl.DateTimeFormat('en-CA', options);
    const [tYear, tMonth, tDay] = formatter.format(new Date()).split('-').map(Number);
    const todayDate = new Date(tYear, tMonth - 1, tDay);
    return inputDate < todayDate;
  })();

  const handleDateChange = (dateVal) => {
    if (!dateVal) {
      setSiteVisitDate('');
      return;
    }
    const [year, month, day] = dateVal.split('-').map(Number);
    const inputDate = new Date(year, month - 1, day);
    
    const options = { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' };
    const formatter = new Intl.DateTimeFormat('en-CA', options);
    const [tYear, tMonth, tDay] = formatter.format(new Date()).split('-').map(Number);
    const todayDate = new Date(tYear, tMonth - 1, tDay);

    if (inputDate < todayDate) {
      setPendingBackDateVal(dateVal);
      setBackDateReason('');
      setShowBackDateModal(true);
    } else {
      setSiteVisitDate(dateVal);
    }
  };

  // Authority Remarks editing states
  const [authorityRemarks, setAuthorityRemarks] = useState('');
  const [savingRemarks, setSavingRemarks] = useState(false);
  const [remarksFormError, setRemarksFormError] = useState('');

  // Photo Upload States
  const [dailySitePhotoUrl, setDailySitePhotoUrl] = useState('');
  const [originalPhotoFilename, setOriginalPhotoFilename] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [photoMissing, setPhotoMissing] = useState(false);

  // Project Search Filters (Directory tab)
  const [searchWO, setSearchWO] = useState('');
  const [searchDept, setSearchDept] = useState('');
  const [searchZone, setSearchZone] = useState('');

  const fileInputRef = useRef(null);

  const isJE = user?.role === 'je';
  const isAuthority = ['zo', 'ho', 'admin'].includes(user?.role);

  const [streak, setStreak] = useState(0);

  useEffect(() => {
    if (isJE) {
      authApi.get('/profile')
        .then(res => {
          if (res.data?.success && res.data.profile) {
            setStreak(res.data.profile.daily_streak || 0);
          }
        })
        .catch(err => console.error('Failed to fetch streak in dashboard:', err));
    }
  }, [isJE]);

  const getTodayDateString = () => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  // Helper: check if a date is older than N days
  const isOlderThanDays = (dateStr, days) => {
    if (!dateStr) return true;
    const reportDate = new Date(dateStr);
    reportDate.setHours(0,0,0,0);
    const today = new Date();
    today.setHours(0,0,0,0);
    const diffTime = today - reportDate;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return diffDays >= days;
  };

  // Fetch projects using React Query
  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const res = await getProjects();
      return res.data?.projects ?? [];
    }
  });

  // Fetch latest global progress reports using React Query
  const { data: allReportsData, isLoading: loadingAllReports, error: allReportsError } = useQuery({
    queryKey: ['progressReports', 'global'],
    queryFn: async () => {
      const res = await getProgressReports({ page: 1, limit: 100 });
      return res.data?.reports ?? [];
    }
  });

  // Fetch reports specifically for active project timeline using React Query
  const { data: projectReportsData, isLoading: loadingProjectReports, error: projectReportsError } = useQuery({
    queryKey: ['progressReports', 'project', activeWO?.work_order_no],
    queryFn: async () => {
      const res = await getProgressReports({
        work_order_no: activeWO.work_order_no,
        page: 1,
        limit: 100
      });
      return (res.data?.reports ?? []).slice().reverse();
    },
    enabled: !!activeWO
  });

  const projects = projectsData || [];
  const allReports = allReportsData || [];
  const reports = projectReportsData || [];
  const loading = loadingAllReports || (activeWO ? loadingProjectReports : false);

  const displayError = error || allReportsError?.response?.data?.message || allReportsError?.message || projectReportsError?.response?.data?.message || projectReportsError?.message || '';

  // Auto-dismiss alerts
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(''), 5000);
    return () => clearTimeout(timer);
  }, [success]);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(''), 6000);
    return () => clearTimeout(timer);
  }, [error]);

  // Upload Photograph Handlers
  const performUpload = async (fileObj) => {
    setUploading(true);
    setUploadError('');
    try {
      const res = await uploadSitePhoto(fileObj);
      if (res.data?.success) {
        setDailySitePhotoUrl(res.data.photo_url);
        setOriginalPhotoFilename(res.data.original_filename);
        setPhotoMissing(false);
      } else {
        throw new Error('Upload failed.');
      }
    } catch (err) {
      console.error('File upload failed:', err);
      setUploadError(err.response?.data?.message || 'Upload failed. Please try again.');
      setDailySitePhotoUrl('');
      setOriginalPhotoFilename('');
    } finally {
      setUploading(false);
    }
  };

  const handlePhotoSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError('');

    // Pre-upload validation: require all other fields first
    if (!siteVisitDate) {
      setUploadError('Please select a Site Visit Date first.');
      e.target.value = '';
      return;
    }
    if (!workProgressDetails || !workProgressDetails.trim()) {
      setUploadError('Please write the Work Progress Details first.');
      e.target.value = '';
      return;
    }
    if (!physicalWorkProgress) {
      setUploadError('Please enter the Physical Progress percentage first.');
      e.target.value = '';
      return;
    }

    if (isSelectedDateBackdated && (!remarksAfterSiteVisit || !remarksAfterSiteVisit.trim())) {
      setUploadError('Remarks explaining the reason are required for back-dated entries.');
      e.target.value = '';
      return;
    }

    const allowedMime = ['image/jpeg', 'image/png'];
    if (!allowedMime.includes(file.type)) {
      setUploadError('Only JPEG, JPG, PNG files are accepted.');
      e.target.value = '';
      return;
    }

    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      setUploadError('File size must not exceed 10MB.');
      e.target.value = '';
      return;
    }

    performUpload(file);
  };

  const handleRemovePhoto = () => {
    setDailySitePhotoUrl('');
    setOriginalPhotoFilename('');
    setUploadError('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const resetForm = () => {
    setSiteVisitDate('');
    setWorkProgressDetails('');
    setPhysicalWorkProgress('');
    setRemarksAfterSiteVisit('');
    handleRemovePhoto();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!activeWO || !siteVisitDate || !workProgressDetails || !physicalWorkProgress || !dailySitePhotoUrl) {
      if (!dailySitePhotoUrl) setPhotoMissing(true);
      setError('Please fill in all required fields and upload a site photo.');
      return;
    }

    const progressVal = parseFloat(physicalWorkProgress);
    if (isNaN(progressVal) || progressVal < 0 || progressVal > 100) {
      setError('Physical progress must be a number between 0.00 and 100.00.');
      return;
    }

    setSubmitLoading(true);
    setError('');
    try {
      const payload = {
        work_order_no: activeWO.work_order_no,
        site_visit_date: siteVisitDate,
        work_progress_details: workProgressDetails,
        physical_work_progress: progressVal,
        daily_site_photo_url: dailySitePhotoUrl,
        original_photo_filename: originalPhotoFilename,
        remarks_after_site_visit: remarksAfterSiteVisit || null
      };

      await createProgressReport(payload);
      setSuccess('Daily progress report row submitted successfully.');
      resetForm();
      setShowCreateFlow(false);
      queryClient.invalidateQueries({ queryKey: ['progressReports'] });
    } catch (err) {
      console.error('Report submission failed:', err);
      if (err.response?.status === 409) {
        setError('A report already exists for this Work Order and Site Visit Date.');
      } else {
        setError(err.response?.data?.message || 'Failed to submit progress report.');
      }
    } finally {
      setSubmitLoading(false);
    }
  };

  // Open detailed view modal (signed URL generated on demand)
  const handleViewDetails = async (reportItem) => {
    setLoadingDetail(true);
    setRemarksFormError('');
    try {
      const res = await getProgressReportById(reportItem.report_id);
      if (res.data?.success) {
        setActiveReport(res.data.report);
        setAuthorityRemarks(res.data.report.remarks_approved_authority || '');
      }
    } catch (err) {
      console.error('Error fetching report details:', err);
      setError(err.response?.data?.message || 'Failed to retrieve report details.');
    } finally {
      setLoadingDetail(false);
    }
  };

  // Save authority remarks
  const handleSaveRemarks = async (action = null) => {
    if (!activeReport) return;
    if (!authorityRemarks.trim()) {
      setRemarksFormError('Remarks cannot be empty.');
      return;
    }

    setSavingRemarks(true);
    setRemarksFormError('');
    try {
      const res = await addAuthorityRemarks(activeReport.report_id, {
        remarks_approved_authority: authorityRemarks.trim(),
        action: action
      });

      if (res.data?.success) {
        setSuccess(action ? `Report ${action}d successfully.` : 'Authority remarks saved successfully.');
        setActiveReport(null);
        queryClient.invalidateQueries({ queryKey: ['progressReports'] });
      }
    } catch (err) {
      console.error('Failed to save remarks:', err);
      setRemarksFormError(err.response?.data?.message || 'Failed to save remarks.');
    } finally {
      setSavingRemarks(false);
    }
  };

  // Filter projects list (landing directory tab)
  const filteredProjects = projects.filter(p => {
    const matchesWO = p.work_order_no.toLowerCase().includes(searchWO.toLowerCase());
    const matchesDept = p.department.toLowerCase().includes(searchDept.toLowerCase());
    const matchesZone = (p.zone || '').toLowerCase().includes(searchZone.toLowerCase());
    return matchesWO && matchesDept && matchesZone;
  });

  // Calculate summary metrics for active project spreadsheet
  const getSummaryMetrics = () => {
    if (reports.length === 0) {
      return { totalDays: 0, firstDate: 'N/A', lastDate: 'N/A', overallProgress: 0 };
    }
    const totalDays = reports.length;
    const datesSorted = reports
      .map(r => r.site_visit_date)
      .filter(Boolean)
      .sort((a, b) => new Date(a) - new Date(b));

    const firstDate = datesSorted[0] ? new Date(datesSorted[0]).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : 'N/A';
    const lastDate = datesSorted[datesSorted.length - 1] ? new Date(datesSorted[datesSorted.length - 1]).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : 'N/A';

    const chronologicallySorted = [...reports].sort((a, b) => new Date(a.site_visit_date) - new Date(b.site_visit_date));
    const overallProgress = chronologicallySorted[chronologicallySorted.length - 1]?.physical_work_progress || 0;

    return { totalDays, firstDate, lastDate, overallProgress };
  };

  const metrics = getSummaryMetrics();

  // ==========================================
  // CLIENT-SIDE DASHBOARD METRICS GENERATORS
  // ==========================================

  // A. JE Dashboard Metrics
  const getJEDashboardData = () => {
    const totalLogged = allReports.length;
    const lastLogged = allReports[0]?.site_visit_date
      ? new Date(allReports[0].site_visit_date).toLocaleDateString('en-IN', { dateStyle: 'medium' })
      : 'N/A';
    const activeSitesCount = new Set(allReports.map(r => r.work_order_no)).size;

    // JE Active Sites: running projects this JE has logged reports on
    const activeSitesList = projects.filter(p => {
      return p.status === 'Running' && allReports.some(r => r.work_order_no === p.work_order_no);
    });

    // Inactivity alerts (Active sites with no logs in the last 3 days)
    const inactivityAlerts = activeSitesList.filter(p => {
      const logsForProject = allReports.filter(r => r.work_order_no === p.work_order_no);
      if (logsForProject.length === 0) return true;
      // Since allReports is sorted DESC, the first matches the latest log
      const latestLogDate = logsForProject[0].site_visit_date;
      return isOlderThanDays(latestLogDate, 3);
    });

    return {
      totalLogged,
      lastLogged,
      activeSitesCount,
      activeSitesList,
      inactivityAlerts,
      recentLogs: allReports.slice(0, 5)
    };
  };

  // B. Authority Dashboard Metrics
  const getAuthDashboardData = () => {
    const liveCount = projects.filter(p => p.status === 'Running').length;
    const todayString = getTodayDateString();
    const logsToday = allReports.filter(r => r.site_visit_date === todayString).length;
    const pendingReview = allReports.filter(r => r.approval_status === 'Pending').length;

    // Calculate Average Progress across active projects
    const activeProjects = projects.filter(p => p.status === 'Running');
    let totalProgressSum = 0;
    let countedProjects = 0;

    activeProjects.forEach(p => {
      // Find latest progress entered for this project
      const projectLogs = allReports.filter(r => r.work_order_no === p.work_order_no);
      if (projectLogs.length > 0) {
        totalProgressSum += parseFloat(projectLogs[0].physical_work_progress || 0);
        countedProjects++;
      }
    });
    const avgProgress = countedProjects > 0 ? (totalProgressSum / countedProjects).toFixed(1) : '0';

    // Stale projects list (Active projects with no reports in last 7 days)
    const staleSites = activeProjects.filter(p => {
      const projectLogs = allReports.filter(r => r.work_order_no === p.work_order_no);
      if (projectLogs.length === 0) return true; // No reports at all = stale
      const latestLogDate = projectLogs[0].site_visit_date;
      return isOlderThanDays(latestLogDate, 7);
    });

    // Review Queue (Action Required)
    const reviewQueue = allReports.filter(r => r.approval_status === 'Pending').slice(0, 6);

    return {
      liveCount,
      logsToday,
      pendingReview,
      avgProgress,
      staleSites,
      reviewQueue,
      activityFeed: allReports.slice(0, 10)
    };
  };

  const jeData = isJE ? getJEDashboardData() : null;
  const authData = isAuthority ? getAuthDashboardData() : null;

  return (
    <div className="h-screen bg-black text-slate-100 flex flex-col md:flex-row font-sans relative overflow-hidden">
      <BackgroundShapes />
      <Sidebar />
      <MobileHeader />

      <div className="flex-grow flex flex-col min-w-0 overflow-hidden">
        <TopNavbar />
        <main className="flex-grow p-6 md:p-10 overflow-y-auto w-full relative z-10">
        
        {/* Status Alerts */}
        {displayError && (
          <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 mb-5 flex items-center gap-2.5 shadow-lg">
            <span className="w-2 h-2 rounded-full bg-red-500 shrink-0 animate-ping" />
            {displayError}
          </div>
        )}
        {success && (
          <div className="p-4 bg-emerald-950/20 border border-emerald-900/30 rounded-2xl text-xs text-emerald-300 mb-5 flex items-center gap-2.5 shadow-lg">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            {success}
          </div>
        )}

        {/* ──────────────── PAGE FLOW ──────────────── */}
        {activeWO ? (
          /* ========================================================
             PROJECT DRILL DOWN VIEW (SPREADSHEET GRID)
             ======================================================== */
          <div className="space-y-6 animate-fadeIn max-w-7xl mx-auto">
            
            {/* Nav Header */}
            <div className="flex justify-between items-center pb-4 border-b border-white/5">
              <button
                onClick={() => {
                  setActiveWO(null);
                  setActiveReport(null);
                  setShowCreateFlow(false);
                }}
                className="group flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-emerald-500 hover:text-emerald-400 transition"
              >
                <svg className="w-4 h-4 transform group-hover:-translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Back to Dashboard
              </button>
              
              <h2 className="text-sm font-bold tracking-wider text-slate-400 font-sans">
                Daily Work Progress Entry Sheet
              </h2>
            </div>

            {/* Geographical details boxes */}
            <div className="glass-panel p-5 rounded-3xl border border-white/5 bg-gradient-to-br from-white/[0.01] to-transparent space-y-4">
              <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                <div className="flex-grow w-full">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Selected Work Order</label>
                  <div className="bg-white/5 border border-white/5 rounded-xl px-4 py-3 text-xs font-bold text-emerald-400 font-mono text-left">
                    {activeWO.work_order_no}
                  </div>
                </div>
                <div className="shrink-0 flex items-center gap-2 mt-4 sm:mt-0">
                  <Badge variant={activeWO.status === 'Running' ? 'emerald' : 'red'} showDot={false}>
                    Project Status: {activeWO.status === 'Running' ? 'Active' : activeWO.status}
                  </Badge>
                </div>
              </div>

              {/* Geo inputs row */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <Input label="State" disabled value={activeWO.state} size="sm" />
                <Input label="District" disabled value={activeWO.district} size="sm" />
                <Input label="Area Code (Zone)" disabled value={activeWO.zone || 'N/A'} size="sm" />
                <Input label="Department" disabled value={activeWO.department} size="sm" className="truncate" title={activeWO.department} />
                <Input label="Site Details" disabled value={activeWO.site_details} size="sm" className="truncate" title={activeWO.site_details} containerClassName="col-span-2 md:col-span-1" />
              </div>
            </div>

            {/* Ledger Spreadsheet list */}
            <div className="glass-panel rounded-3xl border border-white/5 overflow-hidden shadow-2xl bg-gradient-to-br from-white/[0.01] to-transparent">
              <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/[0.01]">
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Daily Log History Ledger</span>
                {isJE && activeWO.status === 'Running' && !showCreateFlow && (
                  <button
                    onClick={() => setShowCreateFlow(true)}
                    className="bg-white hover:bg-slate-100 text-slate-950 px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition shadow flex items-center gap-1.5"
                  >
                    <svg className="w-3.5 h-3.5 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Append Daily Entry Row
                  </button>
                )}
              </div>

            <Table className="text-xs">
              <TableHeader className="bg-white/[0.02] text-slate-400">
                <TableRow hover={false} className="text-[9px]">
                  <TableCell isHeader={true} align="center" className="w-12 border-r border-white/5" size="sm">Sl No.</TableCell>
                  <TableCell isHeader={true} className="w-32 border-r border-white/5" size="sm">Site Visit Date</TableCell>
                  <TableCell isHeader={true} className="border-r border-white/5" size="sm">Work Progress Details</TableCell>
                  <TableCell isHeader={true} align="center" className="w-36 border-r border-white/5" size="sm">Physical Progress (%)</TableCell>
                  <TableCell isHeader={true} align="center" className="w-28 border-r border-white/5" size="sm">Site Photo <span className="text-red-400">*</span></TableCell>
                  <TableCell isHeader={true} className="border-r border-white/5" size="sm">Remarks After Site Visit</TableCell>
                  <TableCell isHeader={true} className="pr-4" size="sm">Remarks Approved Authority</TableCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((report, idx) => (
                  <TableRow
                    key={report.report_id}
                    onClick={() => handleViewDetails(report)}
                    interactive={true}
                    className="text-slate-300 text-left"
                  >
                    <TableCell align="center" className="font-mono font-semibold border-r border-white/5 text-slate-500" size="sm">
                      {idx + 1}
                    </TableCell>
                    <TableCell className="font-semibold border-r border-white/5 text-slate-200" size="sm">
                      {report.site_visit_date ? new Date(report.site_visit_date).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : 'N/A'}
                    </TableCell>
                    <TableCell className="border-r border-white/5 truncate max-w-[200px]" title={report.work_progress_details} size="sm">
                      {report.work_progress_details}
                    </TableCell>
                    <TableCell align="center" className="font-mono font-bold text-emerald-400 border-r border-white/5" size="sm">
                      {report.physical_work_progress}%
                    </TableCell>
                    <TableCell align="center" className="border-r border-white/5" size="sm">
                      <div className="flex justify-center items-center gap-1 text-[10px] text-emerald-400 font-bold font-mono">
                        <svg className="w-3.5 h-3.5 stroke-[2]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <span>View</span>
                      </div>
                    </TableCell>
                    <TableCell className="border-r border-white/5 truncate max-w-[150px]" title={report.remarks_after_site_visit || ''} size="sm">
                      {report.remarks_after_site_visit || <span className="text-slate-600 italic">None</span>}
                    </TableCell>
                    <TableCell className="pr-4 truncate max-w-[180px]" title={report.remarks_approved_authority || ''} size="sm">
                      {report.remarks_approved_authority ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-slate-300">{report.remarks_approved_authority}</span>
                          <span className={`text-[8px] font-bold uppercase ${
                            report.approval_status === 'Approved' ? 'text-emerald-400' :
                            report.approval_status === 'Rejected' ? 'text-red-400' : 'text-amber-500'
                          }`}>
                            [{report.approval_status === 'Rejected' ? 'REJECTED DUE TO BACKDATE' : (report.approval_status || 'Approved')}]
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className={`text-[8px] font-bold uppercase ${
                            report.approval_status === 'Approved' ? 'text-emerald-400' :
                            report.approval_status === 'Rejected' ? 'text-red-400' : 'text-amber-500'
                          }`}>
                            [{report.approval_status === 'Rejected' ? 'REJECTED DUE TO BACKDATE' : (report.approval_status || 'Approved')}]
                          </span>
                          {report.approval_status === 'Pending' && (
                            <span className="text-slate-600 italic">Pending review</span>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}

                {/* Inline input form row for JE */}
                {showCreateFlow && (
                  <TableRow hover={false} className="bg-emerald-500/[0.02] border-t border-b border-emerald-500/20 text-left">
                    <TableCell align="center" className="font-mono font-bold border-r border-emerald-500/20 text-emerald-400" size="sm">
                      {reports.length + 1}
                    </TableCell>
                    <TableCell className="border-r border-emerald-500/20" size="sm">
                      <Input
                        type="date"
                        required
                        value={siteVisitDate}
                        max={getTodayDateString()}
                        onChange={(e) => handleDateChange(e.target.value)}
                        size="sm"
                      />
                    </TableCell>
                    <TableCell className="border-r border-emerald-500/20" size="sm">
                      <TextArea
                        required
                        rows={2}
                        value={workProgressDetails}
                        placeholder="Describe work done today..."
                        onChange={(e) => setWorkProgressDetails(e.target.value)}
                        size="sm"
                      />
                    </TableCell>
                    <TableCell className="border-r border-emerald-500/20" size="sm">
                      <Input
                        type="number"
                        required
                        step="0.01"
                        min="0"
                        max="100"
                        value={physicalWorkProgress}
                        placeholder="%"
                        onChange={(e) => setPhysicalWorkProgress(e.target.value)}
                        size="sm"
                        className="text-center font-mono font-bold"
                      />
                    </TableCell>
                    <TableCell align="center" className="border-r border-emerald-500/20" size="sm">
                      <input
                        type="file"
                        ref={fileInputRef}
                        accept="image/jpeg,image/png"
                        onChange={handlePhotoSelect}
                        className="hidden"
                        id="je-photo-file-sheet"
                      />
                      
                      {uploading ? (
                        <span className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-emerald-500 inline-block" />
                      ) : dailySitePhotoUrl ? (
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-[9px] text-emerald-400 font-extrabold">Uploaded ✓</span>
                          <Button
                            variant="secondary"
                            size="xs"
                            onClick={handleRemovePhoto}
                            className="text-[8px] uppercase tracking-wider text-red-400 hover:text-red-300 font-bold"
                          >
                            Remove
                          </Button>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-1">
                          <Button
                            variant="glass"
                            size="xs"
                            className={photoMissing ? 'border-red-500 bg-red-500/10 text-red-400 animate-pulse' : ''}
                            onClick={() => fileInputRef.current?.click()}
                          >
                            Upload
                          </Button>
                          {photoMissing && <span className="text-[8px] text-red-400 font-bold">Required</span>}
                        </div>
                      )}
                      {uploadError && <p className="text-[8px] text-red-400 mt-1 leading-tight">{uploadError}</p>}
                    </TableCell>
                    <TableCell className="border-r border-emerald-500/20" size="sm">
                      <TextArea
                        rows={2}
                        value={remarksAfterSiteVisit}
                        placeholder={isSelectedDateBackdated ? "Reason for back-dating (REQUIRED)..." : "Observations remarks..."}
                        onChange={(e) => setRemarksAfterSiteVisit(e.target.value)}
                        size="sm"
                      />
                    </TableCell>
                    <TableCell size="sm">
                      <div className="flex gap-2 justify-end">
                        <Button
                          variant="secondary"
                          size="xs"
                          onClick={() => {
                            resetForm();
                            setShowCreateFlow(false);
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="success"
                          size="xs"
                          onClick={handleSubmit}
                          loading={submitLoading}
                          disabled={uploading}
                        >
                          Save
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>

              {/* Aggregated spreadsheet summary metrics */}
              <div className="p-4 border-t border-white/5 bg-emerald-950/5 border-l border-r border-b rounded-b-3xl">
                <span className="text-[9px] uppercase font-black tracking-widest text-emerald-400 font-sans">Ledger Aggregated Summary Metrics</span>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-2">
                  <div className="p-3 rounded-2xl bg-black/40 border border-white/5 text-center">
                    <p className="text-[8px] font-bold uppercase tracking-widest text-slate-500">Total Days Logged</p>
                    <p className="text-lg font-black text-slate-100 mt-1">{metrics.totalDays}</p>
                  </div>
                  <div className="p-3 rounded-2xl bg-black/40 border border-white/5 text-center">
                    <p className="text-[8px] font-bold uppercase tracking-widest text-slate-500">First Visit Date</p>
                    <p className="text-xs font-mono font-bold text-slate-200 mt-2">{metrics.firstDate}</p>
                  </div>
                  <div className="p-3 rounded-2xl bg-black/40 border border-white/5 text-center">
                    <p className="text-[8px] font-bold uppercase tracking-widest text-slate-500">Last Visit Date</p>
                    <p className="text-xs font-mono font-bold text-slate-200 mt-2">{metrics.lastDate}</p>
                  </div>
                  <div className="p-3 rounded-2xl bg-emerald-950/20 border border-emerald-900/30 text-center">
                    <p className="text-[8px] font-bold uppercase tracking-widest text-emerald-400">Current Cumulative Progress</p>
                    <p className="text-lg font-black text-emerald-400 mt-1">{metrics.overallProgress}%</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ========================================================
             PRIMARY CONTROLLER: DASHBOARD & ACTIVE DIRECTORY TABS
             ======================================================== */
          <div className="space-y-6 animate-fadeIn">
            {/* Header section with Tab selector */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 pb-6 border-b border-white/5">
              <div>
                <span className="text-[10px] uppercase font-bold tracking-widest text-emerald-500 font-sans">
                  Site Operations · Daily Tracking Console
                </span>
                <div className="flex items-center gap-3 mt-1">
                  <h1 className="text-3xl font-extrabold tracking-tight text-slate-100">Daily Work Progress</h1>
                  {isJE && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold uppercase tracking-wider bg-orange-500/10 text-orange-400 border border-orange-500/20 animate-pulse">
                      <span>🔥</span>
                      <span>{streak} Day Streak</span>
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 font-medium mt-1.5">
                  Analyze site reports, review photographs, and log authority comments.
                </p>
              </div>

              {/* Navigation Tab Switcher */}
              <div className="flex bg-white/5 p-1 rounded-2xl border border-white/5 shrink-0 self-stretch md:self-auto">
                <button
                  onClick={() => setCurrentTab('dashboard')}
                  className={`flex-grow md:flex-none px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition ${
                    currentTab === 'dashboard'
                      ? 'bg-white text-slate-950 shadow-md'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Overview Dashboard
                </button>
                <button
                  onClick={() => setCurrentTab('directory')}
                  className={`flex-grow md:flex-none px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition ${
                    currentTab === 'directory'
                      ? 'bg-white text-slate-950 shadow-md'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Projects Directory
                </button>
              </div>
            </div>

            {/* TAB 1: OPERATIONS DASHBOARD */}
            {currentTab === 'dashboard' && (
              <div className="space-y-8 animate-fadeIn">
                
                {/* ──────────────── A. JE ROLE DASHBOARD VIEW ──────────────── */}
                {isJE && jeData && (
                  <div className="space-y-6">
                     {/* JE Stats cards */}
                     <div className="grid grid-cols-1 sm:grid-cols-4 gap-6">
                       <div className="glass-panel p-5 rounded-3xl border border-white/5 flex items-center justify-between">
                         <div>
                           <span className="text-[9px] uppercase font-extrabold tracking-widest text-slate-500">My Reports Logged</span>
                           <h3 className="text-2xl font-black text-slate-100 mt-1">{loading ? '...' : jeData.totalLogged}</h3>
                         </div>
                         <div className="p-3 bg-white/5 rounded-2xl text-slate-400">
                           <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2" />
                           </svg>
                         </div>
                       </div>
                       <div className="glass-panel p-5 rounded-3xl border border-white/5 flex items-center justify-between">
                         <div>
                           <span className="text-[9px] uppercase font-extrabold tracking-widest text-slate-500">Active Sites Visited</span>
                           <h3 className="text-2xl font-black text-slate-100 mt-1">{loading ? '...' : jeData.activeSitesCount}</h3>
                         </div>
                         <div className="p-3 bg-indigo-950/20 text-indigo-400 border border-indigo-900/30 rounded-2xl">
                           <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                           </svg>
                         </div>
                       </div>
                       <div className="glass-panel p-5 rounded-3xl border border-white/5 flex items-center justify-between">
                         <div>
                           <span className="text-[9px] uppercase font-extrabold tracking-widest text-slate-500">Last Visit Logged</span>
                           <h3 className="text-lg font-black text-slate-200 mt-2">{loading ? '...' : jeData.lastLogged}</h3>
                         </div>
                         <div className="p-3 bg-emerald-950/20 text-emerald-400 border border-emerald-900/30 rounded-2xl">
                           <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                           </svg>
                         </div>
                       </div>
                       <div className="glass-panel p-5 rounded-3xl border border-white/5 flex items-center justify-between">
                         <div>
                           <span className="text-[9px] uppercase font-extrabold tracking-widest text-slate-500">Daily Upload Streak</span>
                           <h3 className="text-2xl font-black text-orange-400 mt-1">{streak} {streak === 1 ? 'Day' : 'Days'} 🔥</h3>
                         </div>
                         <div className="p-3 bg-orange-950/20 text-orange-400 border border-orange-900/30 rounded-2xl">
                           <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                           </svg>
                         </div>
                       </div>
                     </div>

                    {/* Main JE sections split */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                      
                      {/* Left: My Active Sites & Warnings */}
                      <div className="lg:col-span-7 space-y-6">
                        {/* Inactivity alerts box */}
                        {jeData.inactivityWarnings?.length > 0 && (
                          <div className="border border-red-500/20 bg-red-500/5 p-5 rounded-3xl space-y-3">
                            <div className="flex items-center gap-2 text-red-400">
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                              </svg>
                              <span className="text-[10px] uppercase font-black tracking-widest">Action Alert: Missing Site Logs</span>
                            </div>
                            <p className="text-xs text-slate-300">
                              The following active work orders have not had site visit progress logged in the last **3 days**. Please update their logs:
                            </p>
                            <div className="space-y-2">
                              {jeData.inactivityWarnings.map(p => (
                                <div key={p.work_order_no} className="flex justify-between items-center bg-black/40 p-3 rounded-xl border border-white/5 text-xs">
                                  <span className="font-mono font-bold text-slate-200">{p.work_order_no}</span>
                                  <button
                                    onClick={() => setActiveWO(p)}
                                    className="text-[10px] uppercase font-extrabold text-emerald-500 hover:text-emerald-400"
                                  >
                                    Log Site Visit
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* My Active Sites ledger */}
                        <div className="glass-panel p-5 rounded-3xl border border-white/5 space-y-4">
                          <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block border-b border-white/5 pb-2">
                            My Active Sites Directory
                          </span>
                          
                          {jeData.activeSitesList.length === 0 ? (
                            <p className="text-xs text-slate-500 italic py-6 text-center">
                              No active projects reported on yet. Head to the Projects Directory to open a ledger sheet and log your first check-in!
                            </p>
                          ) : (
                            <div className="space-y-3">
                              {jeData.activeSitesList.map(project => {
                                // Find latest log for stats
                                const logs = allReports.filter(r => r.work_order_no === project.work_order_no);
                                const latestProgress = logs[0]?.physical_work_progress ?? 0;
                                const latestDate = logs[0]?.site_visit_date 
                                  ? new Date(logs[0].site_visit_date).toLocaleDateString('en-IN', { dateStyle: 'short' })
                                  : 'N/A';

                                return (
                                  <div key={project.work_order_no} className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.01] border border-white/5 hover:border-white/10 transition">
                                    <div className="space-y-1 truncate mr-4 text-xs">
                                      <p className="font-mono font-bold text-slate-200">{project.work_order_no}</p>
                                      <p className="text-[10px] text-slate-400 truncate">{project.department} &bull; {project.site_details}</p>
                                      <p className="text-[9px] text-slate-500">Last visited on: {latestDate}</p>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                      <span className="font-mono font-bold text-emerald-400 text-sm">{latestProgress}%</span>
                                      <button
                                        onClick={() => setActiveWO(project)}
                                        className="px-3 py-1.5 bg-white text-slate-950 text-[10px] font-bold uppercase tracking-wider rounded-lg transition"
                                      >
                                        Sheet
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Right: JE Recent Submissions Stream */}
                      <div className="lg:col-span-5 space-y-4">
                        <div className="glass-panel p-5 rounded-3xl border border-white/5 space-y-4">
                          <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block border-b border-white/5 pb-2">
                            My Recent Logs Feed
                          </span>
                          {jeData.recentLogs.length === 0 ? (
                            <p className="text-xs text-slate-500 italic py-6 text-center">No reports logged yet.</p>
                          ) : (
                            <div className="space-y-3">
                              {jeData.recentLogs.map(r => (
                                <button
                                  key={r.report_id}
                                  onClick={() => handleViewDetails(r)}
                                  className="w-full text-left p-3.5 rounded-xl border border-white/5 bg-white/[0.01] hover:bg-white/[0.02] transition flex justify-between items-center"
                                >
                                  <div className="truncate mr-3 text-xs space-y-1">
                                    <p className="font-bold text-slate-200">
                                      {r.site_visit_date ? new Date(r.site_visit_date).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : 'N/A'}
                                    </p>
                                    <p className="font-mono text-[10px] text-slate-400 truncate">{r.work_order_no}</p>
                                    <p className="text-[10px] text-slate-500 truncate italic">"{r.work_progress_details}"</p>
                                  </div>
                                  <span className="font-mono font-bold text-emerald-400 shrink-0 text-xs">{r.physical_work_progress}%</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                    </div>
                  </div>
                )}

                {/* ──────────────── B. AUTHORITY ROLE DASHBOARD VIEW ──────────────── */}
                {isAuthority && authData && (
                  <div className="space-y-6">
                    {/* Stats overview cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <div className="glass-panel p-5 rounded-3xl border border-white/5 flex items-center justify-between">
                        <div>
                          <span className="text-[9px] uppercase font-extrabold tracking-widest text-slate-500">Live Sites Active</span>
                          <h3 className="text-2xl font-black text-slate-100 mt-1">{loading ? '...' : authData.liveCount}</h3>
                        </div>
                        <div className="p-3 bg-white/5 rounded-2xl text-slate-400">
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                          </svg>
                        </div>
                      </div>
                      <div className="glass-panel p-5 rounded-3xl border border-white/5 flex items-center justify-between">
                        <div>
                          <span className="text-[9px] uppercase font-extrabold tracking-widest text-slate-500">Pending Review remarks</span>
                          <h3 className={`text-2xl font-black mt-1 ${authData.pendingReview > 0 ? 'text-amber-500' : 'text-slate-400'}`}>
                            {loading ? '...' : authData.pendingReview}
                          </h3>
                        </div>
                        <div className="p-3 bg-amber-950/20 text-amber-500 border border-amber-900/30 rounded-2xl">
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                        </div>
                      </div>
                    </div>

                    {/* Operational feed layout split */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                      
                      {/* Left: Real-time Live Activity Feed */}
                      <div className="lg:col-span-7 space-y-4">
                        <div className="glass-panel p-5 rounded-3xl border border-white/5 space-y-4">
                          <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block border-b border-white/5 pb-2">
                            Live Site Visit Activity Feed
                          </span>
                          
                          {authData.activityFeed.length === 0 ? (
                            <p className="text-xs text-slate-500 italic py-10 text-center">No reports logged from JEs yet.</p>
                          ) : (
                            <div className="space-y-4">
                              {authData.activityFeed.map(r => (
                                <div
                                  key={r.report_id}
                                  onClick={() => handleViewDetails(r)}
                                  className="p-4 rounded-2xl bg-white/[0.01] border border-white/5 hover:border-white/10 transition cursor-pointer flex gap-4 text-xs items-start"
                                >
                                  {/* Small indicator */}
                                  <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 mt-1 shrink-0 animate-pulse" />
                                  <div className="space-y-1.5 flex-grow truncate">
                                    <div className="flex justify-between items-center">
                                      <p className="font-extrabold text-slate-200">
                                        {r.created_by_name || r.created_by}
                                      </p>
                                      <span className="font-mono text-[10px] text-slate-500">
                                        {r.site_visit_date ? new Date(r.site_visit_date).toLocaleDateString('en-IN', { dateStyle: 'short' }) : ''}
                                      </span>
                                    </div>
                                    <p className="text-slate-400 leading-relaxed truncate">
                                      Logged <strong className="text-slate-200">{r.physical_work_progress}%</strong> progress on <span className="font-mono text-emerald-400 font-bold">{r.work_order_no}</span>
                                    </p>
                                    <p className="text-[10px] text-slate-500 italic truncate">
                                      "{r.work_progress_details}"
                                    </p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Right: Review Queue (Action Required) & Stale Projects alerts */}
                      <div className="lg:col-span-5 space-y-6">
                        
                        {/* Stale Projects alert list */}
                        {authData.staleSites?.length > 0 && (
                          <div className="border border-red-500/20 bg-red-500/5 p-5 rounded-3xl space-y-3">
                            <div className="flex items-center gap-2 text-red-400">
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                              </svg>
                              <span className="text-[10px] uppercase font-black tracking-widest">Inactivity Warning: Stale Projects</span>
                            </div>
                            <p className="text-xs text-slate-300">
                              The following active work orders have **no progress entries logged in the last 7 days**:
                            </p>
                            <div className="space-y-2">
                              {authData.staleSites.slice(0, 5).map(p => (
                                <div key={p.work_order_no} className="flex justify-between items-center bg-black/40 p-3 rounded-xl border border-white/5 text-xs">
                                  <span className="font-mono font-bold text-slate-200">{p.work_order_no}</span>
                                  <button
                                    onClick={() => setActiveWO(p)}
                                    className="text-[10px] uppercase font-extrabold text-red-400 hover:text-red-300"
                                  >
                                    View History
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Review Queue box */}
                        <div className="glass-panel p-5 rounded-3xl border border-white/5 space-y-4">
                          <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block border-b border-white/5 pb-2">
                            Review Queue (Action Required)
                          </span>
                          
                          {authData.reviewQueue.length === 0 ? (
                            <p className="text-xs text-slate-500 italic py-6 text-center">All logged reports have review remarks! Nice job.</p>
                          ) : (
                            <div className="space-y-3">
                              {authData.reviewQueue.map(r => (
                                <button
                                  key={r.report_id}
                                  onClick={() => handleViewDetails(r)}
                                  className="w-full text-left p-3.5 rounded-xl border border-white/5 bg-white/[0.01] hover:bg-white/[0.02] transition flex justify-between items-center"
                                >
                                  <div className="truncate mr-3 text-xs space-y-1">
                                    <p className="font-bold text-slate-200">{r.created_by_name || r.created_by}</p>
                                    <p className="font-mono text-[10px] text-emerald-400 font-bold">{r.work_order_no}</p>
                                    <p className="text-[10px] text-slate-500 truncate italic">"{r.work_progress_details}"</p>
                                  </div>
                                  <span className="text-[10px] uppercase font-bold text-amber-500 shrink-0">Review</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                      </div>

                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: PROJECTS REGISTRY DIRECTORY */}
            {currentTab === 'directory' && (
              <div className="space-y-6 animate-fadeIn">
                {/* Search filters */}
                <div className="glass-panel p-5 rounded-3xl border border-white/5 flex flex-col gap-4">
                  <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400">Filter Work Orders Directory</span>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Input
                      type="text"
                      value={searchWO}
                      onChange={(e) => setSearchWO(e.target.value)}
                      placeholder="Search Work Order Number..."
                      size="sm"
                    />
                    <Input
                      type="text"
                      value={searchDept}
                      onChange={(e) => setSearchDept(e.target.value)}
                      placeholder="Filter by Department..."
                      size="sm"
                    />
                    <Input
                      type="text"
                      value={searchZone}
                      onChange={(e) => setSearchZone(e.target.value)}
                      placeholder="Filter by Zone/Area..."
                      size="sm"
                    />
                  </div>
                </div>

                {/* Grid layout list */}
                <div className="glass-panel rounded-3xl overflow-hidden shadow-2xl border border-white/5 bg-gradient-to-br from-white/[0.01] to-transparent">
                  <div className="p-5 border-b border-white/5 flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Projects Registry</span>
                    <span className="px-2 py-0.5 bg-slate-800 text-slate-300 font-mono text-[10px] rounded-lg">
                      {filteredProjects.length} projects
                    </span>
                  </div>

                  {loading ? (
                    <div className="p-6 space-y-4">
                      {[...Array(4)].map((_, idx) => (
                        <div key={idx} className="h-12 w-full bg-white/[0.02] rounded-xl border border-white/5 animate-pulse" />
                      ))}
                    </div>
                  ) : filteredProjects.length === 0 ? (
                    <div className="text-center p-20 text-slate-500 text-xs uppercase font-extrabold tracking-widest">
                      No projects matching directory filters.
                    </div>
                  ) : (
                    <Table>
                      <TableHeader className="bg-white/[0.01]">
                        <TableRow hover={false} className="text-[9px]">
                          <TableCell isHeader={true} className="pl-6" size="sm">Work Order No</TableCell>
                          <TableCell isHeader={true} size="sm">Department</TableCell>
                          <TableCell isHeader={true} size="sm">Zone (Area)</TableCell>
                          <TableCell isHeader={true} size="sm">State / District</TableCell>
                          <TableCell isHeader={true} align="center" size="sm">Status</TableCell>
                          <TableCell isHeader={true} className="pr-6" align="right" size="sm">Actions</TableCell>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredProjects.map((project) => (
                          <TableRow
                            key={project.work_order_no}
                            className="text-slate-300 text-left"
                          >
                            <TableCell className="pl-6 font-mono font-bold text-slate-200" size="sm">
                              {project.work_order_no}
                            </TableCell>
                            <TableCell className="font-semibold text-slate-300 truncate max-w-[200px]" title={project.department} size="sm">
                              {project.department}
                            </TableCell>
                            <TableCell className="font-mono font-semibold text-slate-300" size="sm">
                              {project.zone || 'N/A'}
                            </TableCell>
                            <TableCell size="sm">
                              {project.state} / {project.district}
                            </TableCell>
                            <TableCell align="center" size="sm">
                              <Badge variant={project.status === 'Running' ? 'emerald' : 'red'} showDot={false}>
                                {project.status === 'Running' ? 'Active' : project.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="pr-6" align="right" size="sm">
                              <Button
                                onClick={() => setActiveWO(project)}
                                size="xs"
                              >
                                View Ledger Sheet
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* DETAIL MODAL FOR LIVE ACTIVITY FEEDS & REVIEW QUEUE */}
        {activeReport && (
          <Modal
            isOpen={!!activeReport}
            onClose={() => setActiveReport(null)}
            title={`Site visit date: ${new Date(activeReport.site_visit_date).toLocaleDateString('en-IN', { dateStyle: 'medium' })}`}
            subtitle="Daily Log Entry details"
            size="lg"
            footer={
              <div className="flex justify-end w-full">
                <Button
                  variant="glass"
                  onClick={() => setActiveReport(null)}
                >
                  Close Details
                </Button>
              </div>
            }
          >
            {loadingDetail ? (
              <div className="py-12 flex flex-col items-center justify-center text-slate-500 text-xs font-bold uppercase tracking-widest">
                <span className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-emerald-500 mb-2" />
                Retrieving detail parameters...
              </div>
            ) : (
              <div className="space-y-4 text-xs text-left">
                
                {/* Photo Viewer */}
                <div>
                  <span className="text-[9px] uppercase font-extrabold text-slate-500 tracking-wider">Site visit photo</span>
                  {activeReport.photo_signed_url ? (
                    <div className="relative group rounded-xl overflow-hidden aspect-video border border-white/5 bg-slate-950 mt-1 max-h-[220px]">
                      <img
                        src={activeReport.photo_signed_url}
                        alt="Site Visit"
                        className="w-full h-full object-contain cursor-zoom-in"
                        onClick={() => window.open(activeReport.photo_signed_url, '_blank')}
                      />
                    </div>
                  ) : (
                    <div className="h-32 flex flex-col items-center justify-center text-slate-500 border border-white/5 rounded-xl bg-slate-900/20 mt-1">
                      <span className="text-[10px] uppercase font-bold tracking-widest">Photo Unavailable</span>
                    </div>
                  )}
                </div>

                {/* Info details */}
                <div className="grid grid-cols-2 gap-4 bg-white/[0.01] p-3 border border-white/5 rounded-xl">
                  <div>
                    <p className="text-[9px] uppercase text-slate-500 font-extrabold">Work Order No</p>
                    <p className="text-slate-200 font-bold font-mono mt-0.5">{activeReport.work_order_no}</p>
                  </div>
                  <div>
                    <p className="text-[9px] uppercase text-slate-500 font-extrabold">Logged By & Progress</p>
                    <p className="text-slate-200 font-bold mt-0.5">
                      {activeReport.created_by_name || activeReport.created_by} &bull; <span className="text-emerald-400 font-mono font-bold">{activeReport.physical_work_progress}%</span>
                    </p>
                  </div>
                </div>

                {/* Geographical snapshot information */}
                <div className="bg-indigo-500/5 border border-indigo-500/10 p-3 rounded-xl space-y-1">
                  <p className="text-[8px] uppercase tracking-widest font-extrabold text-indigo-400">Locked Geographical Metadata</p>
                  <p className="text-[10px] text-slate-300">
                    <strong>Location:</strong> {activeReport.site_details} ({activeReport.district}, {activeReport.state} - Zone {activeReport.area_code})
                  </p>
                  <p className="text-[10px] text-slate-300">
                    <strong>Department:</strong> {activeReport.department}
                  </p>
                </div>

                {/* Work details */}
                <div>
                  <span className="text-[9px] uppercase font-extrabold text-slate-500 tracking-wider">Work details</span>
                  <div className="p-3 bg-white/[0.02] border border-white/5 rounded-xl text-slate-300 mt-1 leading-relaxed whitespace-pre-wrap">
                    {activeReport.work_progress_details}
                  </div>
                </div>

                {/* JE observations */}
                {activeReport.remarks_after_site_visit && (
                  <div>
                    <span className="text-[9px] uppercase font-extrabold text-slate-500 tracking-wider">JE remarks/observations</span>
                    <div className="p-3 bg-white/[0.02] border border-white/5 rounded-xl text-slate-300 mt-1 leading-relaxed whitespace-pre-wrap">
                      {activeReport.remarks_after_site_visit}
                    </div>
                  </div>
                )}

                {/* Authority Remarks block */}
                <div className="border border-white/5 p-4 rounded-2xl bg-white/[0.01] space-y-3">
                  <div className="flex items-center justify-between border-b border-white/5 pb-1">
                    <span className="text-[9px] uppercase font-extrabold text-slate-500 tracking-wider block">ZO/HO review remarks</span>
                    <span className={`text-[8px] font-bold uppercase px-2 py-0.5 rounded-full ${
                      activeReport.approval_status === 'Approved' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                      activeReport.approval_status === 'Rejected' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                      'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                    }`}>
                      {activeReport.approval_status === 'Rejected' ? 'REJECTED DUE TO BACKDATE' : (activeReport.approval_status || 'Approved')}
                    </span>
                  </div>
                  {isAuthority ? (
                    <div className="space-y-3">
                      <TextArea
                        value={authorityRemarks}
                        onChange={(e) => setAuthorityRemarks(e.target.value)}
                        placeholder="Add review remarks..."
                        rows={2}
                        size="sm"
                      />
                      {remarksFormError && <p className="text-[10px] text-red-400 font-semibold">{remarksFormError}</p>}
                      
                      {activeReport.approval_status === 'Pending' ? (
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="danger"
                            onClick={() => handleSaveRemarks('Reject')}
                            disabled={!authorityRemarks.trim()}
                            loading={savingRemarks}
                            size="sm"
                          >
                            Reject Report
                          </Button>
                          <Button
                            variant="success"
                            onClick={() => handleSaveRemarks('Approve')}
                            disabled={!authorityRemarks.trim()}
                            loading={savingRemarks}
                            size="sm"
                          >
                            Approve Report
                          </Button>
                        </div>
                      ) : (
                        <div className="flex justify-end">
                          <Button
                            onClick={() => handleSaveRemarks(null)}
                            disabled={!authorityRemarks.trim()}
                            loading={savingRemarks}
                            size="sm"
                          >
                            Save Remarks
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : (
                    activeReport.remarks_approved_authority ? (
                      <div className="space-y-2">
                        <p className="p-3 bg-emerald-950/5 border border-emerald-900/10 rounded-xl text-slate-300 italic">
                          "{activeReport.remarks_approved_authority}"
                        </p>
                        <p className="text-[9px] text-slate-500">
                          Reviewed By: {activeReport.approved_by_name || activeReport.approved_user_id} on {activeReport.approval_date ? new Date(activeReport.approval_date).toLocaleString('en-IN') : 'N/A'}
                        </p>
                      </div>
                    ) : (
                      <p className="text-slate-500 italic text-[11px]">No review remarks submitted yet.</p>
                    )
                  )}
                </div>

              </div>
            )}
          </Modal>
        )}
        {/* ── BACKDATE REASON MODAL ── */}
        {showBackDateModal && (
          <Modal
            isOpen={true}
            onClose={handleCancelBackDate}
            title="Back-Dated Entry Reason"
            subtitle="Daily Progress"
            size="sm"
            footer={
              <div className="flex justify-end gap-3 w-full">
                <Button
                  variant="secondary"
                  onClick={handleCancelBackDate}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={handleConfirmBackDate}
                  disabled={!backDateReason.trim()}
                >
                  Confirm Reason
                </Button>
              </div>
            }
          >
            <div className="space-y-4 text-left">
              <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-xs dark:text-amber-200 text-amber-800">
                <div className="font-bold flex items-center gap-1.5 mb-1 dark:text-amber-400 text-amber-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  Back-Dated Entry Detected
                </div>
                You have selected a date prior to today. Please provide a brief reason for recording a back-dated progress log.
              </div>
              <TextArea
                label="Reason for Back-Dating"
                value={backDateReason}
                onChange={(e) => setBackDateReason(e.target.value)}
                placeholder="Enter the reason here..."
                required
                rows={3}
              />
            </div>
          </Modal>
        )}
      </main>
      </div>
    </div>
  );
};

export default DailyProgress;
