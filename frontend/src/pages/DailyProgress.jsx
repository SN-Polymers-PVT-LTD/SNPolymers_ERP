import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../components/AuthContext';
import { Link } from 'react-router-dom';
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
  
  // Master lists
  const [reports, setReports] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Page layout toggles
  const [showCreateFlow, setShowCreateFlow] = useState(false);
  const [activeReport, setActiveReport] = useState(null); // Full report detail object (enriched from GET /:id)
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);

  // Form State
  const [selectedWO, setSelectedWO] = useState('');
  const [selectedProject, setSelectedProject] = useState(null);
  const [siteVisitDate, setSiteVisitDate] = useState('');
  const [workProgressDetails, setWorkProgressDetails] = useState('');
  const [physicalWorkProgress, setPhysicalWorkProgress] = useState('');
  const [remarksAfterSiteVisit, setRemarksAfterSiteVisit] = useState('');

  // File Upload State
  const [uploadedPhoto, setUploadedPhoto] = useState(null); // Local File object
  const [dailySitePhotoUrl, setDailySitePhotoUrl] = useState(''); // Server path
  const [originalPhotoFilename, setOriginalPhotoFilename] = useState(''); // File name
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // Filter States
  const [filterWO, setFilterWO] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterJE, setFilterJE] = useState('');

  // Pagination
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 15,
    total: 0,
    totalPages: 1
  });

  const fileInputRef = useRef(null);

  // Authorization helper
  const isJE = user?.role === 'je';
  const isAuthority = ['zo', 'ho', 'admin'].includes(user?.role);

  // Get current date string for max date validation
  const getTodayDateString = () => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  // Fetch Master Data & Reports
  const fetchData = useCallback(async (targetPage = 1) => {
    setLoading(true);
    setError('');
    try {
      // 1. Fetch active projects list for dropdown selection (JE creates / Users filter)
      const projRes = await getProjects();
      const allProjects = projRes.data?.projects ?? [];
      setProjects(allProjects);

      // 2. Fetch daily progress reports with pagination & active filters
      const params = {
        page: targetPage,
        limit: pagination.limit
      };
      if (filterWO) params.work_order_no = filterWO;
      if (filterDateFrom) params.date_from = filterDateFrom;
      if (filterDateTo) params.date_to = filterDateTo;
      if (isAuthority && filterJE) params.created_by = filterJE;

      const reportRes = await getProgressReports(params);
      if (reportRes.data?.success) {
        setReports(reportRes.data.reports ?? []);
        if (reportRes.data.pagination) {
          setPagination(reportRes.data.pagination);
        }
      }
    } catch (err) {
      console.error('Error fetching Daily Progress data:', err);
      setError(err.response?.data?.message || 'Failed to retrieve reports data.');
    } finally {
      setLoading(false);
    }
  }, [filterWO, filterDateFrom, filterDateTo, filterJE, isAuthority, pagination.limit]);

  useEffect(() => {
    fetchData(1);
  }, [filterWO, filterDateFrom, filterDateTo, filterJE]);

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

  // Handle Work Order selection change in creation form
  const handleWOChange = (woNo) => {
    setSelectedWO(woNo);
    // Clear and reset state metadata to prevent stale details
    setUploadedPhoto(null);
    setDailySitePhotoUrl('');
    setOriginalPhotoFilename('');
    setUploadError('');
    if (fileInputRef.current) fileInputRef.current.value = '';

    if (!woNo) {
      setSelectedProject(null);
      return;
    }

    const proj = projects.find(p => p.work_order_no === woNo);
    setSelectedProject(proj || null);
  };

  // Perform backend upload for the selected file
  const performUpload = async (fileObj) => {
    setUploading(true);
    setUploadError('');
    try {
      const res = await uploadSitePhoto(fileObj);
      if (res.data?.success) {
        setDailySitePhotoUrl(res.data.photo_url);
        setOriginalPhotoFilename(res.data.original_filename);
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

  // Immediate upload handler for site visit photograph selection
  const handlePhotoSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError('');

    // Local type check
    const allowedMime = ['image/jpeg', 'image/png'];
    if (!allowedMime.includes(file.type)) {
      setUploadError('Only image files (JPEG, JPG, PNG) are accepted.');
      setUploadedPhoto(null);
      e.target.value = null;
      return;
    }

    // Local size check (10MB limit)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      setUploadError('File size must not exceed 10MB.');
      setUploadedPhoto(null);
      e.target.value = null;
      return;
    }

    setUploadedPhoto(file);
    performUpload(file);
  };

  // Retry the upload for the stored File object
  const handleRetryUpload = () => {
    if (uploadedPhoto) {
      performUpload(uploadedPhoto);
    }
  };

  // Remove the currently selected/uploaded photo
  const handleRemovePhoto = () => {
    setUploadedPhoto(null);
    setDailySitePhotoUrl('');
    setOriginalPhotoFilename('');
    setUploadError('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Opens the file dialog
  const handleChooseAnotherPhoto = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  // Reset entire creation form fields
  const resetForm = () => {
    setSelectedWO('');
    setSelectedProject(null);
    setSiteVisitDate('');
    setWorkProgressDetails('');
    setPhysicalWorkProgress('');
    setRemarksAfterSiteVisit('');
    handleRemovePhoto();
  };

  // JE Report submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedWO || !siteVisitDate || !workProgressDetails || !physicalWorkProgress || !dailySitePhotoUrl) {
      setError('Please fill in all required fields and upload a site photo.');
      return;
    }

    const progressVal = parseFloat(physicalWorkProgress);
    if (isNaN(progressVal) || progressVal < 0 || progressVal > 100) {
      setError('Physical work progress must be a number between 0.00 and 100.00.');
      return;
    }

    setSubmitLoading(true);
    setError('');
    try {
      const payload = {
        work_order_no: selectedWO,
        site_visit_date: siteVisitDate,
        work_progress_details: workProgressDetails,
        physical_work_progress: progressVal,
        daily_site_photo_url: dailySitePhotoUrl,
        original_photo_filename: originalPhotoFilename,
        remarks_after_site_visit: remarksAfterSiteVisit || null
      };

      await createProgressReport(payload);
      setSuccess('Daily progress report submitted successfully.');
      resetForm();
      setShowCreateFlow(false);
      fetchData(1);
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

  // Load and view detailed report drawer
  const handleViewDetails = async (reportItem) => {
    setLoadingDetail(true);
    setError('');
    try {
      const res = await getProgressReportById(reportItem.report_id);
      if (res.data?.success) {
        // Enriched details includes full photo signed url
        setActiveReport(res.data.report);
      }
    } catch (err) {
      console.error('Error fetching report details:', err);
      setError(err.response?.data?.message || 'Failed to retrieve report details.');
    } finally {
      setLoadingDetail(false);
    }
  };

  // Stat Card aggregations
  const getStats = () => {
    // Total matching filter (or master reports if filters not active)
    const total = pagination.total || reports.length;
    
    // Reports in current month based on site_visit_date
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    const thisMonthCount = reports.filter(r => {
      if (!r.site_visit_date) return false;
      const visitDate = new Date(r.site_visit_date);
      return visitDate.getMonth() === currentMonth && visitDate.getFullYear() === currentYear;
    }).length;

    // Reports that contain authority remarks
    const remarksCount = reports.filter(r => r.remarks_approved_authority).length;

    return { total, thisMonth: thisMonthCount, withRemarks: remarksCount };
  };

  const stats = getStats();

  // Handle paginated page changes
  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= pagination.totalPages) {
      fetchData(newPage);
    }
  };

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

        {/* ──────────────── PANEL FLOW: Creation / Details or Main Dashboard ──────────────── */}
        {showCreateFlow ? (
          /* ========================================================
             1. CREATE DAILY REPORT PANEL
             ======================================================== */
          <div className="glass-panel p-6 md:p-8 rounded-3xl border border-white/5 bg-gradient-to-br from-white/[0.01] to-transparent max-w-4xl mx-auto">
            <div className="flex items-center justify-between pb-4 mb-6 border-b border-white/5">
              <div>
                <span className="text-[10px] uppercase font-bold tracking-widest text-emerald-500 font-mono">JE Form · Site Visit Details</span>
                <h2 className="text-2xl font-extrabold text-slate-100 mt-1">Log Daily Work Progress</h2>
              </div>
              <button
                onClick={() => {
                  resetForm();
                  setShowCreateFlow(false);
                }}
                className="p-2.5 rounded-xl bg-white/5 border border-white/5 text-slate-400 hover:text-slate-200 transition hover:bg-white/10"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Read-Only Top Metadata */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6 p-4 rounded-2xl bg-white/[0.02] border border-white/5 text-xs text-slate-400">
              <div className="flex justify-between items-center px-2">
                <span>Reporter User ID (Mobile)</span>
                <span className="font-semibold text-slate-200">{user?.mobile_number}</span>
              </div>
              <div className="flex justify-between items-center px-2 sm:border-l sm:border-white/5">
                <span>Current Clock Date</span>
                <span className="font-semibold text-slate-200">{new Date().toLocaleDateString('en-IN', { dateStyle: 'medium' })}</span>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Inputs: Left Column */}
                <div className="space-y-4">
                  {/* Active Work Order Selector */}
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                      Work Order Number <span className="text-red-400">*</span>
                    </label>
                    <select
                      value={selectedWO}
                      onChange={(e) => handleWOChange(e.target.value)}
                      required
                      className="w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-xs font-semibold text-slate-200 transition bg-black"
                    >
                      <option value="">-- Select Active Work Order --</option>
                      {projects
                        .filter(p => p.status === 'Running')
                        .map(p => (
                          <option key={p.work_order_no} value={p.work_order_no}>
                            {p.work_order_no}
                          </option>
                        ))}
                    </select>
                  </div>

                  {/* Site Visit Date */}
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                      Site Visit Date <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="date"
                      value={siteVisitDate}
                      onChange={(e) => setSiteVisitDate(e.target.value)}
                      required
                      max={getTodayDateString()}
                      className="w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-xs font-semibold text-slate-100 transition bg-black"
                    />
                  </div>

                  {/* Physical Work Progress (%) */}
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                      Physical Work Progress (%) <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={physicalWorkProgress}
                      onChange={(e) => setPhysicalWorkProgress(e.target.value)}
                      placeholder="Cumulative percentage (0.00 to 100.00)"
                      required
                      className="w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-xs font-mono font-bold text-slate-100 transition bg-black"
                    />
                  </div>
                </div>

                {/* Geography Snapshot Display: Right Column */}
                <div className="space-y-4">
                  <div className="h-full rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-4 flex flex-col justify-between min-h-[220px]">
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-indigo-400 mb-3 flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        Project Geographical Snapshots
                      </p>
                      {selectedProject ? (
                        <div className="grid grid-cols-2 gap-3.5 text-left">
                          <div>
                            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">State / District</p>
                            <p className="text-xs font-semibold text-slate-300 mt-0.5 truncate">{selectedProject.state} / {selectedProject.district}</p>
                          </div>
                          <div>
                            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Area Code (Zone)</p>
                            <p className="text-xs font-semibold text-slate-300 mt-0.5 truncate">{selectedProject.zone || 'N/A'}</p>
                          </div>
                          <div className="col-span-2">
                            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Department</p>
                            <p className="text-xs font-semibold text-slate-300 mt-0.5 truncate">{selectedProject.department}</p>
                          </div>
                          <div className="col-span-2">
                            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Site Details</p>
                            <p className="text-xs font-semibold text-slate-300 mt-0.5 leading-relaxed">{selectedProject.site_details}</p>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-32 text-center text-slate-500 text-xs">
                          <span className="italic">Select a work order number to auto-fill geographical metadata snapshots.</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Textarea fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                    Work Progress Details <span className="text-red-400">*</span>
                  </label>
                  <textarea
                    value={workProgressDetails}
                    onChange={(e) => setWorkProgressDetails(e.target.value)}
                    required
                    placeholder="Describe specific tasks completed at the site today..."
                    rows={4}
                    className="w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-xs font-semibold text-slate-200 transition bg-black resize-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                    Remarks After Site Visit (Optional)
                  </label>
                  <textarea
                    value={remarksAfterSiteVisit}
                    onChange={(e) => setRemarksAfterSiteVisit(e.target.value)}
                    placeholder="Add minor site visit observations, remarks, or notifications..."
                    rows={4}
                    className="w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-xs font-semibold text-slate-200 transition bg-black resize-none"
                  />
                </div>
              </div>

              {/* Photograph Upload Area */}
              <div className="p-5 border border-white/5 rounded-2xl bg-white/[0.01]">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                  Daily Site Photograph <span className="text-red-400">*</span>
                </label>
                
                {/* Upload Status Card */}
                {!dailySitePhotoUrl ? (
                  <div className="space-y-4">
                    <div className="flex flex-col items-center justify-center p-6 border border-dashed border-white/10 rounded-xl bg-black/40">
                      <input
                        type="file"
                        ref={fileInputRef}
                        accept="image/jpeg,image/png"
                        onChange={handlePhotoSelect}
                        className="hidden"
                        id="je-photo-file"
                      />
                      
                      {uploading ? (
                        <div className="flex flex-col items-center gap-2 py-2">
                          <span className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-emerald-500" />
                          <span className="text-[10px] uppercase tracking-widest text-slate-400 font-extrabold mt-1">Uploading site photo...</span>
                        </div>
                      ) : uploadError ? (
                        <div className="text-center py-2 space-y-3">
                          <p className="text-xs text-red-400 font-semibold">{uploadError}</p>
                          <div className="flex gap-3 justify-center">
                            <button
                              type="button"
                              onClick={handleRetryUpload}
                              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] uppercase tracking-wider transition"
                            >
                              Retry Upload
                            </button>
                            <button
                              type="button"
                              onClick={handleChooseAnotherPhoto}
                              className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-slate-300 font-bold text-[10px] uppercase tracking-wider transition"
                            >
                              Choose Another
                            </button>
                            <button
                              type="button"
                              onClick={handleRemovePhoto}
                              className="px-3 py-1.5 rounded-lg bg-red-950/40 hover:bg-red-900/40 text-red-300 font-bold text-[10px] uppercase tracking-wider transition border border-red-900/30"
                            >
                              Clear
                            </button>
                          </div>
                        </div>
                      ) : (
                        <label
                          htmlFor="je-photo-file"
                          className="flex flex-col items-center cursor-pointer py-4 group"
                        >
                          <svg className="w-10 h-10 text-slate-500 group-hover:text-slate-300 transition mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          <span className="text-[10px] font-bold uppercase tracking-widest bg-white/5 border border-white/5 text-slate-300 hover:bg-white/10 px-4 py-2 rounded-xl transition shadow">
                            Select Photo (JPG / PNG ≤ 10MB)
                          </span>
                        </label>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col sm:flex-row items-center gap-4 p-4 rounded-xl bg-emerald-950/10 border border-emerald-900/20">
                    {/* Small thumbnail preview of uploaded photo */}
                    {uploadedPhoto && (
                      <img
                        src={URL.createObjectURL(uploadedPhoto)}
                        alt="Upload Preview"
                        className="w-16 h-16 object-cover rounded-lg border border-emerald-500/20 shrink-0"
                      />
                    )}
                    <div className="flex-grow text-center sm:text-left space-y-1">
                      <p className="text-[10px] uppercase tracking-widest text-emerald-400 font-extrabold flex items-center gap-1.5 justify-center sm:justify-start">
                        <svg className="w-3.5 h-3.5 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Photo Uploaded Successfully
                      </p>
                      <p className="text-xs text-slate-400 font-mono truncate max-w-xs">{originalPhotoFilename}</p>
                    </div>
                    <button
                      type="button"
                      onClick={handleRemovePhoto}
                      className="px-4 py-2 bg-red-950/20 hover:bg-red-900/30 text-red-300 font-bold text-[10px] uppercase tracking-wider rounded-xl transition border border-red-900/30"
                    >
                      Remove Photo
                    </button>
                  </div>
                )}
              </div>

              {/* Submit Buttons */}
              <div className="flex justify-end items-center gap-4 pt-4 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => {
                    resetForm();
                    setShowCreateFlow(false);
                  }}
                  className="px-5 py-3 text-slate-400 hover:text-slate-200 font-extrabold text-xs uppercase tracking-wider transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitLoading || uploading}
                  className="bg-white hover:bg-slate-100 text-slate-950 px-6 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition shadow-lg disabled:opacity-40"
                >
                  {submitLoading ? 'Submitting Report...' : 'Save Report'}
                </button>
              </div>
            </form>
          </div>
        ) : activeReport ? (
          /* ========================================================
             2. VIEW REPORT DETAILS PANEL
             ======================================================== */
          <div className="glass-panel p-6 md:p-8 rounded-3xl border border-white/5 bg-gradient-to-br from-white/[0.01] to-transparent max-w-4xl mx-auto">
            <div className="flex items-center justify-between pb-4 mb-6 border-b border-white/5">
              <div>
                <span className="text-[10px] uppercase font-bold tracking-widest text-emerald-500 font-mono">Daily Report Record Detail</span>
                <h2 className="text-2xl font-extrabold text-slate-100 mt-1">Work Order {activeReport.work_order_no}</h2>
              </div>
              <button
                onClick={() => setActiveReport(null)}
                className="p-2.5 rounded-xl bg-white/5 border border-white/5 text-slate-400 hover:text-slate-200 transition hover:bg-white/10"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
              {/* Report Information Details */}
              <div className="space-y-6">
                
                {/* Meta details list */}
                <div className="glass-panel p-5 rounded-2xl border border-white/5 space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Submitted By</p>
                      <p className="text-slate-300 font-semibold mt-0.5">{activeReport.created_by_name || activeReport.created_by}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Site Visit Date</p>
                      <p className="text-slate-300 font-semibold mt-0.5">
                        {activeReport.site_visit_date ? new Date(activeReport.site_visit_date).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : 'N/A'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Cumulative Progress</p>
                      <p className="text-slate-300 font-semibold font-mono mt-0.5 text-base text-emerald-400">
                        {activeReport.physical_work_progress}%
                      </p>
                    </div>
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Submission Timestamp</p>
                      <p className="text-slate-400 mt-0.5">
                        {activeReport.created_at ? new Date(activeReport.created_at).toLocaleDateString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : 'N/A'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Snapshots geographical details */}
                <div className="p-5 rounded-2xl border border-indigo-500/20 bg-indigo-500/5 text-xs text-slate-300 space-y-3">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-indigo-400">
                    &darr; Historical Geographical Snapshot (Locked at Submission)
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">State / District</p>
                      <p className="text-slate-300 mt-0.5">{activeReport.state} / {activeReport.district}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Area Code (Zone)</p>
                      <p className="text-slate-300 mt-0.5">{activeReport.area_code}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Department</p>
                      <p className="text-slate-300 mt-0.5">{activeReport.department}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Site Details</p>
                      <p className="text-slate-300 mt-0.5 leading-relaxed">{activeReport.site_details}</p>
                    </div>
                  </div>
                </div>

                {/* Progress Details Content */}
                <div className="space-y-2">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Work Progress Details</h4>
                  <div className="p-4 bg-white/[0.02] border border-white/5 rounded-2xl text-xs text-slate-300 leading-relaxed min-h-[100px] whitespace-pre-wrap">
                    {activeReport.work_progress_details}
                  </div>
                </div>

                {/* Remarks after Site Visit */}
                {activeReport.remarks_after_site_visit && (
                  <div className="space-y-2">
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Remarks After Site Visit</h4>
                    <div className="p-4 bg-white/[0.02] border border-white/5 rounded-2xl text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">
                      {activeReport.remarks_after_site_visit}
                    </div>
                  </div>
                )}
              </div>

              {/* Photograph and Authority Remarks: Right Column */}
              <div className="space-y-6">
                {/* Photo Viewer */}
                <div className="glass-panel p-4 rounded-3xl border border-white/5 overflow-hidden bg-black/60">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">Site Photograph</h4>
                  {activeReport.photo_signed_url ? (
                    <div className="relative group rounded-2xl overflow-hidden aspect-video border border-white/5 bg-slate-950">
                      <img
                        src={activeReport.photo_signed_url}
                        alt={`Site Visit ${activeReport.work_order_no}`}
                        className="w-full h-full object-contain cursor-zoom-in"
                        onClick={() => window.open(activeReport.photo_signed_url, '_blank')}
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition duration-300 pointer-events-none">
                        <span className="text-[10px] font-bold uppercase tracking-wider bg-black/80 px-3 py-1.5 rounded-xl border border-white/10">Click to expand</span>
                      </div>
                    </div>
                  ) : (
                    <div className="h-40 flex flex-col items-center justify-center text-slate-500 border border-white/5 rounded-2xl bg-slate-900/20">
                      <svg className="w-8 h-8 text-slate-600 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <span className="text-[10px] uppercase font-bold tracking-widest">Photograph Unavailable</span>
                    </div>
                  )}
                </div>

                {/* Authority Remarks Block */}
                <div className="glass-panel p-5 rounded-3xl border border-white/5 space-y-4">
                  <div className="flex items-center justify-between pb-2 border-b border-white/5">
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Authority Remarks</h4>
                    {activeReport.remarks_approved_authority ? (
                      <span className="px-2 py-0.5 bg-emerald-950/20 text-emerald-400 border border-emerald-900/30 text-[9px] font-extrabold uppercase rounded-lg">Reviewed</span>
                    ) : (
                      <span className="px-2 py-0.5 bg-slate-800 text-slate-400 text-[9px] font-extrabold uppercase rounded-lg">No Remarks</span>
                    )}
                  </div>

                  {activeReport.remarks_approved_authority ? (
                    <div className="space-y-3">
                      <div className="p-4 bg-emerald-950/5 border border-emerald-900/10 rounded-2xl text-xs text-slate-300 leading-relaxed italic whitespace-pre-wrap">
                        "{activeReport.remarks_approved_authority}"
                      </div>
                      <div className="text-[10px] text-slate-400 space-y-1">
                        <div className="flex justify-between">
                          <span>Reviewed By</span>
                          <span className="font-bold text-slate-300">{activeReport.approved_by_name || activeReport.approved_user_id}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Review Timestamp</span>
                          <span className="font-mono text-slate-400">
                            {activeReport.approval_date ? new Date(activeReport.approval_date).toLocaleDateString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : 'N/A'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 italic">No authority reviews or remarks have been submitted for this daily progress report record yet.</p>
                  )}
                </div>
              </div>
            </div>
            
            <div className="flex justify-end pt-6 mt-6 border-t border-white/5">
              <button
                onClick={() => setActiveReport(null)}
                className="px-5 py-2.5 rounded-xl border border-white/10 hover:bg-white/5 font-extrabold text-xs uppercase tracking-wider transition text-slate-300 hover:text-slate-100"
              >
                Close View
              </button>
            </div>
          </div>
        ) : (
          /* ========================================================
             3. MAIN DASHBOARD / LIST MODE
             ======================================================== */
          <div>
            {/* Page Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-8 pb-6 border-b border-white/5">
              <div>
                <span className="text-[10px] uppercase font-bold tracking-widest text-emerald-500 font-mono">
                  Site Operations · Daily Tracking
                </span>
                <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Daily Work Progress</h1>
                <p className="text-xs text-slate-400 font-medium mt-1.5">
                  Track site progress reports, view uploaded photographs, and log supervisor remarks.
                </p>
              </div>
              {isJE && (
                <button
                  onClick={() => setShowCreateFlow(true)}
                  className="bg-white hover:bg-slate-100 text-slate-950 px-5 py-3 rounded-xl text-xs font-bold uppercase tracking-wider shadow-lg hover:shadow-xl transition-all duration-300 flex items-center gap-2 shrink-0 transform hover:-translate-y-0.5"
                >
                  <svg className="w-4 h-4 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  New Daily Report
                </button>
              )}
            </div>

            {/* Dynamic Stat Metrics */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
              <div className="glass-panel p-5 rounded-3xl border border-white/5 flex items-center justify-between">
                <div>
                  <span className="text-[9px] uppercase font-extrabold tracking-widest text-slate-500">Total Submitted Reports</span>
                  <h3 className="text-2xl font-black text-slate-100 mt-1">{loading ? '...' : stats.total}</h3>
                </div>
                <div className="p-3 bg-white/5 rounded-2xl text-slate-400">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2" />
                  </svg>
                </div>
              </div>
              <div className="glass-panel p-5 rounded-3xl border border-white/5 flex items-center justify-between">
                <div>
                  <span className="text-[9px] uppercase font-extrabold tracking-widest text-slate-500">Reports This Month</span>
                  <h3 className="text-2xl font-black text-slate-100 mt-1">{loading ? '...' : stats.thisMonth}</h3>
                </div>
                <div className="p-3 bg-emerald-950/20 text-emerald-400 border border-emerald-900/30 rounded-2xl">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
              </div>
              <div className="glass-panel p-5 rounded-3xl border border-white/5 flex items-center justify-between">
                <div>
                  <span className="text-[9px] uppercase font-extrabold tracking-widest text-slate-500">With Authority Remarks</span>
                  <h3 className="text-2xl font-black text-slate-100 mt-1">{loading ? '...' : stats.withRemarks}</h3>
                </div>
                <div className="p-3 bg-indigo-950/20 text-indigo-400 border border-indigo-900/30 rounded-2xl">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Filter Bar */}
            <div className="glass-panel p-5 rounded-3xl border border-white/5 mb-8 flex flex-col gap-4">
              <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400">Search and Filter Reports</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                
                {/* Work Order select filter */}
                <div>
                  <select
                    value={filterWO}
                    onChange={(e) => setFilterWO(e.target.value)}
                    className="w-full glass-input focus:ring-0 outline-none rounded-xl px-3.5 py-2.5 text-xs text-slate-200 bg-black border border-white/5"
                  >
                    <option value="">-- All Work Orders --</option>
                    {projects.map(p => (
                      <option key={p.work_order_no} value={p.work_order_no}>
                        {p.work_order_no}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Date From */}
                <div>
                  <input
                    type="date"
                    value={filterDateFrom}
                    onChange={(e) => setFilterDateFrom(e.target.value)}
                    placeholder="Date From"
                    className="w-full glass-input focus:ring-0 outline-none rounded-xl px-3.5 py-2.5 text-xs text-slate-200 bg-black border border-white/5"
                  />
                </div>

                {/* Date To */}
                <div>
                  <input
                    type="date"
                    value={filterDateTo}
                    onChange={(e) => setFilterDateTo(e.target.value)}
                    placeholder="Date To"
                    className="w-full glass-input focus:ring-0 outline-none rounded-xl px-3.5 py-2.5 text-xs text-slate-200 bg-black border border-white/5"
                  />
                </div>

                {/* JE (Reporter) select filter (ZO/HO/Admin only) */}
                {isAuthority ? (
                  <div>
                    <select
                      value={filterJE}
                      onChange={(e) => setFilterJE(e.target.value)}
                      className="w-full glass-input focus:ring-0 outline-none rounded-xl px-3.5 py-2.5 text-xs text-slate-200 bg-black border border-white/5"
                    >
                      <option value="">-- All Reporting JEs --</option>
                      {/* Extract unique reporter identities from reports list */}
                      {Array.from(new Set(reports.map(r => r.created_by))).map(mobile => {
                        const rep = reports.find(r => r.created_by === mobile);
                        const name = rep?.created_by_name || mobile;
                        return (
                          <option key={mobile} value={mobile}>
                            {name}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                ) : (
                  <div className="hidden md:block" />
                )}
              </div>
            </div>

            {/* Reports List Table Grid */}
            <div className="glass-panel rounded-3xl overflow-hidden shadow-2xl border border-white/5">
              <div className="p-5 border-b border-white/5 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Reports Directory Listing</span>
                <button
                  onClick={() => fetchData(pagination.page)}
                  title="Refresh Reports"
                  className="p-2 rounded-xl glass-input hover:border-white/20 transition text-slate-400 hover:text-slate-200"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </div>

              {loading ? (
                /* Elegant Skeleton Table Layout */
                <div className="p-6 space-y-4">
                  {[...Array(5)].map((_, idx) => (
                    <div key={idx} className="h-12 w-full bg-white/[0.02] rounded-xl border border-white/5 animate-pulse flex items-center justify-between px-4">
                      <div className="h-3.5 w-1/4 bg-white/10 rounded" />
                      <div className="h-3.5 w-1/6 bg-white/10 rounded" />
                      <div className="h-3.5 w-1/12 bg-white/10 rounded" />
                      <div className="h-3.5 w-1/5 bg-white/10 rounded" />
                    </div>
                  ))}
                </div>
              ) : reports.length === 0 ? (
                <div className="text-center p-20 text-slate-500 text-xs uppercase font-extrabold tracking-widest">
                  No daily progress reports matching filters.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-white/5 text-[9px] uppercase font-bold tracking-widest text-slate-400 bg-white/[0.01]">
                        {isAuthority && <th className="p-4 pl-6">JE Reporter</th>}
                        <th className="p-4 pl-6">Work Order</th>
                        <th className="p-4">Visit Date</th>
                        <th className="p-4 text-center">Progress %</th>
                        <th className="p-4">Work Progress Details</th>
                        <th className="p-4 text-center">Photo</th>
                        <th className="p-4 text-center">Remarks</th>
                        <th className="p-4 pr-6 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {reports.map((report) => (
                        <tr
                          key={report.report_id}
                          className="hover:bg-white/[0.02] transition duration-200 text-slate-300"
                        >
                          {isAuthority && (
                            <td className="p-4 pl-6 font-semibold text-slate-200">
                              {report.created_by_name || report.created_by}
                            </td>
                          )}
                          <td className="p-4 pl-6 font-mono font-bold text-slate-200">
                            {report.work_order_no}
                          </td>
                          <td className="p-4">
                            {report.site_visit_date ? new Date(report.site_visit_date).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : 'N/A'}
                          </td>
                          <td className="p-4 text-center font-mono font-bold text-emerald-400">
                            {report.physical_work_progress}%
                          </td>
                          <td className="p-4 max-w-[200px] truncate" title={report.work_progress_details}>
                            {report.work_progress_details}
                          </td>
                          <td className="p-4 text-center">
                            <div className="flex justify-center">
                              <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                            </div>
                          </td>
                          <td className="p-4 text-center">
                            <div className="flex justify-center">
                              {report.remarks_approved_authority ? (
                                <span className="px-2 py-0.5 bg-emerald-950/20 text-emerald-400 border border-emerald-900/30 text-[9px] font-extrabold uppercase rounded-lg">Yes</span>
                              ) : (
                                <span className="px-2 py-0.5 bg-slate-800 text-slate-400 text-[9px] font-extrabold uppercase rounded-lg">No</span>
                              )}
                            </div>
                          </td>
                          <td className="p-4 pr-6 text-right">
                            <button
                              onClick={() => handleViewDetails(report)}
                              className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-slate-200 hover:text-white font-extrabold text-[10px] uppercase tracking-wider rounded-lg transition border border-white/5"
                            >
                              View Details
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pagination Controls */}
              {pagination.totalPages > 1 && (
                <div className="p-4 border-t border-white/5 flex items-center justify-between text-slate-400">
                  <span className="text-[10px] uppercase font-bold tracking-wider">
                    Page {pagination.page} of {pagination.totalPages} ({pagination.total} records)
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handlePageChange(pagination.page - 1)}
                      disabled={pagination.page === 1 || loading}
                      className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/5 hover:bg-white/10 text-xs font-bold transition disabled:opacity-30"
                    >
                      &larr; Prev
                    </button>
                    <button
                      onClick={() => handlePageChange(pagination.page + 1)}
                      disabled={pagination.page === pagination.totalPages || loading}
                      className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/5 hover:bg-white/10 text-xs font-bold transition disabled:opacity-30"
                    >
                      Next &rarr;
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default DailyProgress;
