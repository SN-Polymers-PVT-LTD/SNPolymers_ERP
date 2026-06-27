import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../components/AuthContext';
import BackgroundShapes from '../components/BackgroundShapes';
import Sidebar, { MobileHeader } from '../components/Sidebar';

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

  // Master lists
  const [projects, setProjects] = useState([]);
  const [allReports, setAllReports] = useState([]); // Global reports for dashboard feeds/stats
  const [activeWO, setActiveWO] = useState(null); // Selected project object (for spreadsheet view)
  const [reports, setReports] = useState([]); // Chronological daily reports for the selected project (activeWO)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

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

  // Authority Remarks editing states
  const [authorityRemarks, setAuthorityRemarks] = useState('');
  const [savingRemarks, setSavingRemarks] = useState(false);
  const [remarksFormError, setRemarksFormError] = useState('');

  // Photo Upload States
  const [uploadedPhoto, setUploadedPhoto] = useState(null);
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

  // Fetch projects directory and global reports on load
  const fetchDashboardData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // 1. Fetch Projects
      const projRes = await getProjects();
      const allProjects = projRes.data?.projects ?? [];
      setProjects(allProjects);

      // 2. Fetch Latest Global reports (limit 100 for dashboard feed)
      const reportRes = await getProgressReports({ page: 1, limit: 100 });
      if (reportRes.data?.success) {
        setAllReports(reportRes.data.reports ?? []);
      }
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
      setError(err.response?.data?.message || 'Failed to retrieve progress tracking data.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch reports specifically for active project timeline (spreadsheet representation)
  const fetchProjectReports = useCallback(async (workOrderNo) => {
    setLoading(true);
    setError('');
    try {
      const params = {
        work_order_no: workOrderNo,
        page: 1,
        limit: 100
      };
      const reportRes = await getProgressReports(params);
      if (reportRes.data?.success) {
        // Sort chronologically ascending (earliest first, latest at bottom)
        const sortedAsc = (reportRes.data.reports ?? []).slice().reverse();
        setReports(sortedAsc);
      }
    } catch (err) {
      console.error('Error fetching reports for project:', err);
      setError(err.response?.data?.message || 'Failed to retrieve progress reports.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  useEffect(() => {
    if (activeWO) {
      fetchProjectReports(activeWO.work_order_no);
    }
  }, [activeWO, fetchProjectReports]);

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
    const allowedMime = ['image/jpeg', 'image/png'];
    if (!allowedMime.includes(file.type)) {
      setUploadError('Only JPEG, JPG, PNG files are accepted.');
      setUploadedPhoto(null);
      return;
    }

    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      setUploadError('File size must not exceed 10MB.');
      setUploadedPhoto(null);
      return;
    }

    setUploadedPhoto(file);
    performUpload(file);
  };

  const handleRemovePhoto = () => {
    setUploadedPhoto(null);
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
      fetchProjectReports(activeWO.work_order_no);
      fetchDashboardData(); // Refresh global counts
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
  const handleSaveRemarks = async () => {
    if (!activeReport) return;
    if (!authorityRemarks.trim()) {
      setRemarksFormError('Remarks cannot be empty.');
      return;
    }

    setSavingRemarks(true);
    setRemarksFormError('');
    try {
      const res = await addAuthorityRemarks(activeReport.report_id, {
        remarks_approved_authority: authorityRemarks.trim()
      });

      if (res.data?.success) {
        setSuccess('Authority remarks saved successfully.');
        setActiveReport(null);
        fetchDashboardData(); // Refresh global feeds
        if (activeWO) {
          fetchProjectReports(activeWO.work_order_no);
        }
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
    const pendingReview = allReports.filter(r => !r.remarks_approved_authority).length;

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
    const reviewQueue = allReports.filter(r => !r.remarks_approved_authority).slice(0, 6);

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

      <main className="flex-grow p-6 md:p-10 overflow-y-auto w-full relative z-10">
        
        {/* Status Alerts */}
        {error && (
          <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 mb-5 flex items-center gap-2.5 shadow-lg">
            <span className="w-2 h-2 rounded-full bg-red-500 shrink-0 animate-ping" />
            {error}
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
                  setReports([]);
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
              
              <h2 className="text-sm font-bold tracking-wider text-slate-400 font-mono">
                Daily Work Progress Entry Sheet
              </h2>
            </div>

            {/* Geographical details boxes */}
            <div className="glass-panel p-5 rounded-3xl border border-white/5 bg-gradient-to-br from-white/[0.01] to-transparent space-y-4">
              <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                <div className="flex-grow w-full">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Selected Work Order</label>
                  <div className="bg-white/5 border border-white/5 rounded-xl px-4 py-3 text-xs font-bold text-emerald-400 font-mono">
                    {activeWO.work_order_no}
                  </div>
                </div>
                <div className="shrink-0 flex items-center gap-2 mt-4 sm:mt-0">
                  <span className={`px-3 py-1.5 border text-[10px] font-extrabold uppercase rounded-xl ${
                    activeWO.status === 'Running'
                      ? 'bg-emerald-950/20 text-emerald-400 border-emerald-900/30'
                      : 'bg-red-950/20 text-red-400 border-red-900/30'
                  }`}>
                    Project Status: {activeWO.status === 'Running' ? 'Active' : activeWO.status}
                  </span>
                </div>
              </div>

              {/* Geo inputs row */}
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

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-white/5 text-[9px] uppercase font-bold tracking-widest text-slate-400 bg-white/[0.02]">
                      <th className="p-3 text-center w-12 border-r border-white/5">Sl No.</th>
                      <th className="p-3 w-32 border-r border-white/5">Site Visit Date</th>
                      <th className="p-3 border-r border-white/5">Work Progress Details</th>
                      <th className="p-3 text-center w-36 border-r border-white/5">Physical Progress (%)</th>
                      <th className="p-3 text-center w-28 border-r border-white/5">Site Photo <span className="text-red-400">*</span></th>
                      <th className="p-3 border-r border-white/5">Remarks After Site Visit</th>
                      <th className="p-3 pr-4">Remarks Approved Authority</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {reports.map((report, idx) => (
                      <tr
                        key={report.report_id}
                        onClick={() => handleViewDetails(report)}
                        className="hover:bg-white/[0.02] cursor-pointer transition duration-150 text-slate-300"
                      >
                        <td className="p-3 text-center font-mono font-semibold border-r border-white/5 text-slate-500">
                          {idx + 1}
                        </td>
                        <td className="p-3 font-semibold border-r border-white/5 text-slate-200">
                          {report.site_visit_date ? new Date(report.site_visit_date).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : 'N/A'}
                        </td>
                        <td className="p-3 border-r border-white/5 truncate max-w-[200px]" title={report.work_progress_details}>
                          {report.work_progress_details}
                        </td>
                        <td className="p-3 text-center font-mono font-bold text-emerald-400 border-r border-white/5">
                          {report.physical_work_progress}%
                        </td>
                        <td className="p-3 text-center border-r border-white/5">
                          <div className="flex justify-center items-center gap-1 text-[10px] text-emerald-400 font-bold font-mono">
                            <svg className="w-3.5 h-3.5 stroke-[2]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            <span>View</span>
                          </div>
                        </td>
                        <td className="p-3 border-r border-white/5 truncate max-w-[150px]" title={report.remarks_after_site_visit || ''}>
                          {report.remarks_after_site_visit || <span className="text-slate-600 italic">None</span>}
                        </td>
                        <td className="p-3 pr-4 truncate max-w-[180px]" title={report.remarks_approved_authority || ''}>
                          {report.remarks_approved_authority ? (
                            <span className="text-slate-300">{report.remarks_approved_authority}</span>
                          ) : (
                            <span className="text-slate-600 italic">Pending review</span>
                          )}
                        </td>
                      </tr>
                    ))}

                    {/* Inline input form row for JE */}
                    {showCreateFlow && (
                      <tr className="bg-emerald-500/[0.02] border-t border-b border-emerald-500/20">
                        <td className="p-3 text-center font-mono font-bold border-r border-emerald-500/20 text-emerald-400">
                          {reports.length + 1}
                        </td>
                        <td className="p-3 border-r border-emerald-500/20">
                          <input
                            type="date"
                            required
                            value={siteVisitDate}
                            max={getTodayDateString()}
                            onChange={(e) => setSiteVisitDate(e.target.value)}
                            className="w-full bg-black border border-white/10 rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-100 outline-none focus:border-emerald-500"
                          />
                        </td>
                        <td className="p-3 border-r border-emerald-500/20">
                          <textarea
                            required
                            rows={2}
                            value={workProgressDetails}
                            placeholder="Describe work done today..."
                            onChange={(e) => setWorkProgressDetails(e.target.value)}
                            className="w-full bg-black border border-white/10 rounded-lg px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-emerald-500 resize-none"
                          />
                        </td>
                        <td className="p-3 border-r border-emerald-500/20">
                          <input
                            type="number"
                            required
                            step="0.01"
                            min="0"
                            max="100"
                            value={physicalWorkProgress}
                            placeholder="%"
                            onChange={(e) => setPhysicalWorkProgress(e.target.value)}
                            className="w-full bg-black border border-white/10 rounded-lg px-2 py-1 text-[11px] font-mono font-bold text-slate-100 outline-none focus:border-emerald-500 text-center"
                          />
                        </td>
                        <td className="p-3 border-r border-emerald-500/20 text-center">
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
                              <button
                                type="button"
                                onClick={handleRemovePhoto}
                                className="text-[8px] uppercase tracking-wider text-red-400 hover:text-red-300 font-bold"
                              >
                                Remove
                              </button>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center gap-1">
                              <label
                                htmlFor="je-photo-file-sheet"
                                className={`cursor-pointer text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-lg transition inline-block ${
                                  photoMissing
                                    ? 'border border-red-500 bg-red-500/10 text-red-400 animate-pulse'
                                    : 'border border-white/10 hover:border-white/20 bg-white/5 hover:bg-white/10 text-slate-300'
                                }`}
                              >
                                Upload
                              </label>
                              {photoMissing && <span className="text-[8px] text-red-400 font-bold">Required</span>}
                            </div>
                          )}
                          {uploadError && <p className="text-[8px] text-red-400 mt-1 leading-tight">{uploadError}</p>}
                        </td>
                        <td className="p-3 border-r border-emerald-500/20">
                          <textarea
                            rows={2}
                            value={remarksAfterSiteVisit}
                            placeholder="Observations remarks..."
                            onChange={(e) => setRemarksAfterSiteVisit(e.target.value)}
                            className="w-full bg-black border border-white/10 rounded-lg px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-emerald-500 resize-none"
                          />
                        </td>
                        <td className="p-3 text-slate-500 italic text-[11px]">
                          <div className="flex gap-2 justify-end">
                            <button
                              type="button"
                              onClick={() => {
                                resetForm();
                                setShowCreateFlow(false);
                              }}
                              className="text-[10px] uppercase font-bold text-slate-400 hover:text-slate-200 px-2 py-1"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={handleSubmit}
                              disabled={submitLoading || uploading}
                              className="bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] uppercase font-bold px-3 py-1 rounded-lg transition shadow disabled:opacity-40"
                            >
                              {submitLoading ? 'Saving...' : 'Save'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Aggregated spreadsheet summary metrics */}
              <div className="p-4 border-t border-white/5 bg-emerald-950/5 border-l border-r border-b rounded-b-3xl">
                <span className="text-[9px] uppercase font-black tracking-widest text-emerald-400 font-mono">Ledger Aggregated Summary Metrics</span>
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
                <span className="text-[10px] uppercase font-bold tracking-widest text-emerald-500 font-mono">
                  Site Operations · Daily Tracking Console
                </span>
                <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Daily Work Progress</h1>
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
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
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
                    <div>
                      <input
                        type="text"
                        value={searchWO}
                        onChange={(e) => setSearchWO(e.target.value)}
                        placeholder="Search Work Order Number..."
                        className="w-full glass-input focus:ring-0 outline-none rounded-xl px-3.5 py-2.5 text-xs text-slate-200 bg-black border border-white/5"
                      />
                    </div>
                    <div>
                      <input
                        type="text"
                        value={searchDept}
                        onChange={(e) => setSearchDept(e.target.value)}
                        placeholder="Filter by Department..."
                        className="w-full glass-input focus:ring-0 outline-none rounded-xl px-3.5 py-2.5 text-xs text-slate-200 bg-black border border-white/5"
                      />
                    </div>
                    <div>
                      <input
                        type="text"
                        value={searchZone}
                        onChange={(e) => setSearchZone(e.target.value)}
                        placeholder="Filter by Zone/Area..."
                        className="w-full glass-input focus:ring-0 outline-none rounded-xl px-3.5 py-2.5 text-xs text-slate-200 bg-black border border-white/5"
                      />
                    </div>
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
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-white/5 text-[9px] uppercase font-bold tracking-widest text-slate-400 bg-white/[0.01]">
                            <th className="p-4 pl-6">Work Order No</th>
                            <th className="p-4">Department</th>
                            <th className="p-4">Zone (Area)</th>
                            <th className="p-4">State / District</th>
                            <th className="p-4 text-center">Status</th>
                            <th className="p-4 pr-6 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {filteredProjects.map((project) => (
                            <tr
                              key={project.work_order_no}
                              className="hover:bg-white/[0.02] transition duration-200 text-slate-300"
                            >
                              <td className="p-4 pl-6 font-mono font-bold text-slate-200">
                                {project.work_order_no}
                              </td>
                              <td className="p-4 font-semibold text-slate-300 truncate max-w-[200px]" title={project.department}>
                                {project.department}
                              </td>
                              <td className="p-4 font-mono font-semibold text-slate-300">
                                {project.zone || 'N/A'}
                              </td>
                              <td className="p-4">
                                {project.state} / {project.district}
                              </td>
                              <td className="p-4 text-center">
                                <span className={`px-2 py-0.5 border text-[9px] font-extrabold uppercase rounded-lg ${
                                  project.status === 'Running'
                                    ? 'bg-emerald-950/20 text-emerald-400 border-emerald-900/30'
                                    : 'bg-red-950/20 text-red-400 border-red-900/30'
                                }`}>
                                  {project.status === 'Running' ? 'Active' : project.status}
                                </span>
                              </td>
                              <td className="p-4 pr-6 text-right">
                                <button
                                  onClick={() => setActiveWO(project)}
                                  className="px-3.5 py-1.5 bg-white hover:bg-slate-100 text-slate-950 hover:shadow-lg font-extrabold text-[10px] uppercase tracking-wider rounded-lg transition transform hover:-translate-y-0.5"
                                >
                                  View Ledger Sheet
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* DETAIL MODAL FOR LIVE ACTIVITY FEEDS & REVIEW QUEUE */}
        {activeReport && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="glass-panel p-6 rounded-3xl border border-white/5 bg-gradient-to-br from-white/[0.02] to-transparent w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl relative animate-scaleUp">
              
              <div className="flex justify-between items-center pb-3 mb-4 border-b border-white/5">
                <div>
                  <span className="text-[9px] uppercase font-bold tracking-widest text-emerald-500 font-mono">Daily Log Entry details</span>
                  <h3 className="text-base font-extrabold text-slate-100">Site visit date: {new Date(activeReport.site_visit_date).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</h3>
                </div>
                <button
                  onClick={() => setActiveReport(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-200 transition"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {loadingDetail ? (
                <div className="py-12 flex flex-col items-center justify-center text-slate-500 text-xs font-bold uppercase tracking-widest">
                  <span className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-emerald-500 mb-2" />
                  Retrieving detail parameters...
                </div>
              ) : (
                <div className="space-y-4 text-xs">
                  
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
                    <span className="text-[9px] uppercase font-extrabold text-slate-500 tracking-wider block border-b border-white/5 pb-1">ZO/HO review remarks</span>
                    {isAuthority ? (
                      <div className="space-y-3">
                        <textarea
                          value={authorityRemarks}
                          onChange={(e) => setAuthorityRemarks(e.target.value)}
                          placeholder="Add review remarks..."
                          rows={2}
                          className="w-full bg-black border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none focus:border-emerald-500 resize-none"
                        />
                        {remarksFormError && <p className="text-[10px] text-red-400 font-semibold">{remarksFormError}</p>}
                        
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={handleSaveRemarks}
                            disabled={savingRemarks || !authorityRemarks.trim()}
                            className="bg-white hover:bg-slate-100 text-slate-950 px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition disabled:opacity-40"
                          >
                            {savingRemarks ? 'Saving...' : 'Save Remarks'}
                          </button>
                        </div>
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

              <div className="flex justify-end pt-4 mt-4 border-t border-white/5">
                <button
                  onClick={() => setActiveReport(null)}
                  className="px-4 py-2 border border-white/10 hover:bg-white/5 text-[10px] font-extrabold uppercase rounded-xl transition text-slate-300"
                >
                  Close Details
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default DailyProgress;
