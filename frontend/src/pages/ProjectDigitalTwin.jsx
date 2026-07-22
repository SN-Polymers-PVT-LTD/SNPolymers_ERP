import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getProjectDigitalTwin } from '../api/analyticsApi';

const formatINR = (value) => {
  const num = Number(value) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(num);
};

const resolvePhotoUrl = (url) => {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) return url;
  return `https://ervvwrmgkiyfzbqjqbcg.supabase.co/storage/v1/object/public/daily-progress-photos/${url}`;
};

const ProjectDigitalTwin = () => {
  const { work_order_no } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');

  // Fetch all component-level digital twin metrics for this project
  const { data: twinData, isLoading, error } = useQuery({
    queryKey: ['projectDigitalTwin', work_order_no],
    queryFn: async () => {
      const res = await getProjectDigitalTwin(work_order_no);
      return res.data;
    },
    retry: false // Avoid background retries on auth failure
  });

  const isForbidden = error?.response?.status === 403;



  const overview = twinData?.overview || {};
  const materials = twinData?.materials || [];
  const approvals = twinData?.approvals || [];
  const budget = twinData?.budget || {};
  const approvedRequisitionAmt = budget.approved_requisitions_amount || 0;
  const overrunAmt = Math.max(0, approvedRequisitionAmt - (overview.work_order_value || 0));
  const overrunPct = Math.max(0, (budget.budget_variance_pct || 0) - 100);
  const photos = twinData?.photos || [];
  const audits = twinData?.audits || [];

  // Tab definitions
  const tabs = [
    { id: 'overview', label: 'Overview & Media', icon: '📋' },
    { id: 'financials', label: 'Financials & Materials', icon: '💰' },
    { id: 'progress', label: 'Progress & Timeline', icon: '📈' },
    { id: 'insights', label: 'Insights & Risks', icon: '⚠️' },
    { id: 'logs', label: 'Activity & Audit Logs', icon: '🔍' }
  ];

  if (isForbidden) {
    return (
      <>
          <main className="flex-grow p-6 md:p-10 flex items-center justify-center relative z-10">
            <div className="glass-panel p-8 rounded-3xl border border-rose-500/20 bg-rose-950/10 text-center max-w-md w-full">
              <div className="w-16 h-16 rounded-full bg-rose-500/10 flex items-center justify-center text-rose-500 mx-auto mb-4 border border-rose-500/20">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m0-6h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
                </svg>
              </div>
              <h2 className="text-xl font-black text-rose-500 uppercase tracking-wider">Access Denied</h2>
              <p className="text-xs text-slate-400 mt-3">You are not mapped to this work order or authorized to view this project's digital twin.</p>
              <button
                onClick={() => navigate('/dashboard')}
                className="mt-6 px-5 py-2.5 rounded-xl bg-slate-900 border border-white/10 text-xs font-bold uppercase tracking-wider hover:bg-white/5 text-slate-200 transition"
              >
                Back to Dashboard
              </button>
            </div>
          </main>
      </>
    );
  }

  return (
    <>
          {/* Header */}
          <div className="mb-8 pb-6 border-b border-white/5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500">Project Performance Twin</span>
              <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1 truncate max-w-lg">
                {overview.site_details || 'Digital Twin Monitor'}
              </h1>
              <p className="text-xs text-slate-400 mt-1.5 font-mono">Work Order: {work_order_no}</p>
            </div>
          </div>

          {isLoading ? (
            <div className="glass-panel p-6 rounded-3xl animate-pulse h-96 bg-white/[0.02] flex-grow" />
          ) : (
            <div className="flex flex-col lg:flex-row gap-8 flex-grow min-h-0">
              
              {/* Tab Navigation Sidebar */}
              <div className="w-full lg:w-64 shrink-0 flex flex-row lg:flex-col gap-2 overflow-x-auto lg:overflow-x-visible no-scrollbar pb-3 lg:pb-0">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all text-left shrink-0 w-auto lg:w-full border ${
                      activeTab === tab.id
                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                        : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/5'
                    }`}
                  >
                    <span>{tab.icon}</span>
                    <span>{tab.label}</span>
                  </button>
                ))}
              </div>

              {/* Active Tab Panel Content */}
              <div className="flex-grow glass-panel p-6 rounded-3xl overflow-y-auto no-scrollbar border border-white/5 relative bg-slate-900/10 min-h-[400px]">
                
                {/* 1. Overview & Media Tab */}
                {activeTab === 'overview' && (
                  <div className="space-y-6">
                    <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 border-b border-white/5 pb-2">Overview &amp; Media</h2>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 text-xs">
                      {/* Left: Metadata */}
                      <div className="space-y-4">
                        <p><span className="text-slate-500 block">Work Order Number</span> <span className="text-slate-200 font-extrabold text-sm">{overview.work_order_no}</span></p>
                        <p>
                          <span className="text-slate-500 block">Estimate ID Link</span>
                          {overview.estimate_id && overview.estimate_id !== 'N/A' ? (
                            <button
                              onClick={() => navigate(`/estimates/${overview.estimate_id}`)}
                              className="text-sky-400 font-extrabold hover:underline text-left"
                            >
                              {overview.estimate_no} ↗
                            </button>
                          ) : (
                            <span className="text-slate-400 font-extrabold">{overview.estimate_no || 'N/A'}</span>
                          )}
                        </p>
                        <p><span className="text-slate-500 block">State</span> <span className="text-slate-200 font-bold">{overview.state}</span></p>
                        <p><span className="text-slate-500 block">District</span> <span className="text-slate-200 font-bold">{overview.district}</span></p>
                        <p><span className="text-slate-500 block">Zonal Region</span> <span className="text-slate-200 font-bold">{overview.zone || 'N/A'}</span></p>
                        <p><span className="text-slate-500 block">Department Branch</span> <span className="text-slate-200 font-bold">{overview.department}</span></p>
                        <p><span className="text-slate-500 block">Site Details</span> <span className="text-slate-200 leading-relaxed font-bold block mt-1">{overview.site_details}</span></p>
                        <p>
                          <span className="text-slate-500 block">Coordinates/Map Link</span> 
                          <a 
                            href={overview.site_latitude && overview.site_longitude
                              ? `https://www.google.com/maps/search/?api=1&query=${overview.site_latitude},${overview.site_longitude}`
                              : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(overview.site_details || '')}`
                            } 
                            target="_blank" 
                            rel="noreferrer" 
                            className="text-sky-400 font-bold hover:underline"
                          >
                            Google Maps Search ↗
                          </a>
                        </p>
                      </div>

                      {/* Right: Docs & Photos */}
                      <div className="space-y-6">
                        <div className="space-y-3">
                          <span className="text-slate-500 font-bold uppercase tracking-widest block text-[10px]">Associated Documents</span>
                          <div className="p-4 rounded-xl bg-white/[0.01] border border-white/5 flex justify-between items-center">
                            <div>
                              <span className="font-bold text-slate-200">Main Cost Estimate</span>
                              <span className="text-[10px] text-slate-500 block mt-0.5">Reference: {overview.estimate_no || 'EST-N/A'}</span>
                            </div>
                            {overview.estimate_id && overview.estimate_id !== 'N/A' && (
                              <button
                                onClick={() => navigate(`/estimates/${overview.estimate_id}`)}
                                className="px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 text-[10px] font-bold uppercase tracking-wider text-amber-500 transition"
                              >
                                Open Estimate
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-slate-500 font-bold uppercase tracking-widest block text-[10px]">
                              Site Attachment Gallery {photos.length > 0 && `(${photos.length} Latest)`}
                            </span>
                          </div>
                          
                          {photos.length > 0 ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              {photos.map((item, idx) => {
                                const photoUrl = resolvePhotoUrl(item.daily_site_photo_url);
                                return (
                                  <div key={item.report_id || idx} className="group relative aspect-video bg-slate-950 rounded-2xl border border-white/10 overflow-hidden flex flex-col justify-between p-3 transition-all hover:border-amber-500/50 shadow-lg">
                                    {photoUrl ? (
                                      <img
                                        src={photoUrl}
                                        alt={item.original_photo_filename || `Site Visit - ${item.site_visit_date}`}
                                        className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                        onError={(e) => {
                                          console.warn('Failed to load image:', photoUrl);
                                        }}
                                      />
                                    ) : null}
                                    
                                    {/* Dark Gradient Overlay */}
                                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/40 to-transparent opacity-80 group-hover:opacity-60 transition-opacity pointer-events-none" />

                                    {/* Top Badges */}
                                    <div className="relative z-10 flex items-center justify-between pointer-events-none">
                                      <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded bg-black/60 text-amber-400 border border-amber-500/30 backdrop-blur-md">
                                        {item.physical_work_progress}% Physical Progress
                                      </span>
                                      <span className="text-[9px] font-mono text-slate-300 bg-black/60 px-2 py-0.5 rounded border border-white/10 backdrop-blur-md">
                                        {item.site_visit_date}
                                      </span>
                                    </div>

                                    {/* Bottom Details */}
                                    <div className="relative z-10 space-y-0.5 pointer-events-none">
                                      <p className="text-[10px] font-bold text-slate-100 truncate">
                                        {item.original_photo_filename || `Daily Progress Photo #${idx + 1}`}
                                      </p>
                                      {item.remarks_after_site_visit && (
                                        <p className="text-[9px] text-slate-400 truncate italic">
                                          "{item.remarks_after_site_visit}"
                                        </p>
                                      )}
                                    </div>

                                    {photoUrl && (
                                      <a
                                        href={photoUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="absolute inset-0 z-20"
                                        title="Click to view high-resolution photo"
                                      />
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="aspect-video bg-white/[0.02] rounded-2xl border border-white/5 flex flex-col items-center justify-center p-6 text-center">
                              <span className="text-2xl mb-2">📷</span>
                              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">No Site Photos Uploaded Yet</p>
                              <p className="text-[9.5px] text-slate-500 mt-1 max-w-xs">
                                Site visit photos attached by Junior Engineers in Daily Progress Reports will automatically appear here.
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. Financials & Materials Tab */}
                {activeTab === 'financials' && (
                  <div className="space-y-6">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-3">
                      <div>
                        <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400">Financials &amp; Materials Variance</h2>
                        <p className="text-[10px] text-slate-500 font-mono mt-0.5">Work Order: {work_order_no}</p>
                      </div>
                      <button
                        onClick={() => navigate(`/ra-final-bills?work_order_no=${encodeURIComponent(work_order_no)}`)}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500 hover:text-black text-xs font-black uppercase tracking-wider transition cursor-pointer self-start sm:self-auto shadow-sm"
                      >
                        <span>📑 Go to RA Bills Section ({work_order_no})</span>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                        </svg>
                      </button>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="glass-panel p-4 rounded-2xl bg-white/[0.01]">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Baseline Budget (WO Value)</span>
                        <div className="text-lg font-black text-slate-200 mt-1">{formatINR(overview.work_order_value)}</div>
                      </div>
                      <div className="glass-panel p-4 rounded-2xl bg-white/[0.01]">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Total Spent (Approved Requisitions)</span>
                        <div className="text-lg font-black text-emerald-400 mt-1">{formatINR(approvedRequisitionAmt)}</div>
                      </div>
                      <div className="glass-panel p-4 rounded-2xl bg-white/[0.01]">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Overrun Deviation</span>
                        <div className={`text-lg font-black mt-1 ${overrunAmt > 0 ? 'text-rose-400' : 'text-slate-400'}`}>
                          {formatINR(overrunAmt)} ({Number(overrunPct).toFixed(1)}%)
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2 mt-4">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Utilization Progress</span>
                      <div className="h-4 bg-white/5 border border-white/5 rounded-full overflow-hidden flex">
                        <div
                          className={`h-full rounded-full transition-all duration-1000 ${
                            Number(overrunPct) > 0 ? 'bg-gradient-to-r from-amber-500 to-rose-500' : 'bg-gradient-to-r from-emerald-500 to-indigo-500'
                          }`}
                          style={{ width: `${Math.min(100, (Number(approvedRequisitionAmt) / Number(overview.work_order_value || 1)) * 100)}%` }}
                        />
                      </div>
                    </div>

                    <div className="pt-4">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block mb-4">Materials Cost Variance Breakdown</span>
                      {materials.length === 0 ? (
                        <div className="text-slate-500 text-xs py-10 text-center uppercase tracking-widest">No materials variance registered</div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="border-b border-white/5 pb-2 text-slate-500">
                                <th className="py-2">Material Head</th>
                                <th className="py-2 text-center">Estimated Budget</th>
                                <th className="py-2 text-center">Approved Spend</th>
                                <th className="py-2 text-center">Budget Variance</th>
                                <th className="py-2 text-right">Deviation Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                              {materials.map((item, idx) => {
                                const devPct = Number(item.variance_pct || 0);
                                const severity = devPct > 15 ? 'Critical' : devPct > 5 ? 'Warning' : 'Normal';
                                
                                return (
                                  <tr key={idx} className="hover:bg-white/5 transition-colors">
                                    <td className="py-3 font-bold text-slate-200">{item.material_main_head}</td>
                                    <td className="py-3 text-center text-slate-400 font-mono">{formatINR(item.estimated_amount)}</td>
                                    <td className="py-3 text-center text-slate-400 font-mono">{formatINR(item.approved_amount)}</td>
                                    <td className={`py-3 text-center font-bold font-mono ${Number(item.variance_amount) > 0 ? 'text-rose-400' : 'text-slate-400'}`}>
                                      {Number(item.variance_amount) > 0 ? `+${formatINR(item.variance_amount)}` : formatINR(item.variance_amount)}
                                    </td>
                                    <td className="py-3 text-right">
                                      <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase ${
                                        severity === 'Critical' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' :
                                        severity === 'Warning' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                                        'bg-white/5 text-slate-400'
                                      }`}>
                                        {severity} ({devPct.toFixed(1)}%)
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 3. Progress & Timeline Tab */}
                {activeTab === 'progress' && (
                  <div className="space-y-6">
                    <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 border-b border-white/5 pb-2">Progress & Project Timeline</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-xs">
                      {/* Physical Progress */}
                      <div className="space-y-6">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block">Physical Site Progress</span>
                        <div className="space-y-4">
                          <div>
                            <span className="text-slate-500">Physical Work Progress</span>
                            <div className="text-3xl font-black mt-1 text-amber-500">{overview.physical_progress || 0}%</div>
                          </div>
                          <div>
                            <span className="text-slate-500">Last Progress Submission</span>
                            <div className="text-slate-300 font-bold mt-1">
                              {overview.last_submission_date ? new Date(overview.last_submission_date).toLocaleDateString('en-IN') : 'No progress submissions'}
                            </div>
                          </div>
                          <div>
                            <span className="text-slate-500">Reporting Health Status</span>
                            <div className="mt-1">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                                overview.reporting_health_score >= 80 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                                overview.reporting_health_score >= 50 ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                                'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                              }`}>
                                Score: {Math.round(overview.reporting_health_score || 0)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Timeline / Calendar */}
                      <div className="space-y-6">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block">Calendar Timeline & Slack</span>
                        <div className="space-y-4">
                          <p><span className="text-slate-500 block">Baseline Start Date</span> <span className="text-slate-200 font-bold">{overview.project_start_date || 'N/A'}</span></p>
                          <p><span className="text-slate-500 block">Baseline End Date</span> <span className="text-slate-200 font-bold">{overview.project_end_date || 'N/A'}</span></p>
                          <p><span className="text-slate-500 block">Calendar Timeline Progress</span> <span className="text-slate-200 font-bold">{Number(overview.timeline_progress_pct || 0).toFixed(1)}%</span></p>
                          <p>
                            <span className="text-slate-500 block">Schedule Slack Deviation</span> 
                            <span className={`font-bold ${overview.schedule_slack_days > 15 ? 'text-rose-400' : 'text-slate-400'}`}>
                              {overview.schedule_slack_days > 0 ? `+${overview.schedule_slack_days} days delay` : `${Math.abs(overview.schedule_slack_days || 0)} days early`}
                            </span>
                          </p>
                          <p><span className="text-slate-500 block">Timeline Reporting Gap</span> <span className="text-slate-300 font-bold">{overview.days_since_last_report ?? 'N/A'} days since last update</span></p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 4. Insights & Risks Tab */}
                {activeTab === 'insights' && (
                  <div className="space-y-6">
                    <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 border-b border-white/5 pb-2">Insights & Risk Analytics</h2>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="glass-panel p-4 rounded-2xl bg-white/[0.01]">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Anomaly Deviation Score</span>
                        <div className="text-lg font-black text-rose-400 mt-1">{Math.round(budget.anomaly_score || 0)}</div>
                      </div>
                      <div className="glass-panel p-4 rounded-2xl bg-white/[0.01]">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Overall Performance Score</span>
                        <div className="text-lg font-black text-emerald-400 mt-1">{Math.round(overview.health_score || 0)} / 100</div>
                      </div>
                      <div className="glass-panel p-4 rounded-2xl bg-white/[0.01]">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Status Categorization</span>
                        <div className="text-lg font-black text-slate-200 mt-1">{overview.health_status || 'Normal'}</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4 text-xs">
                      {/* Alerts */}
                      <div className="space-y-4">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block">Triggered Notifications</span>
                        <div className="space-y-3">
                          {overrunAmt > 0 && (
                            <div className="p-4 rounded-xl border border-rose-500/10 bg-rose-950/10 text-rose-400 text-xs font-bold">
                              ⚠️ WARNING: Project budget has been overrun by {formatINR(overrunAmt)}.
                            </div>
                          )}
                          {overview.schedule_slack_days > 15 && (
                            <div className="p-4 rounded-xl border border-amber-500/10 bg-amber-950/10 text-amber-400 text-xs font-bold">
                              ⚠️ NOTICE: Project is delayed by {overview.schedule_slack_days} days behind baseline.
                            </div>
                          )}
                          {(!overrunAmt || overrunAmt <= 0) && (!overview.schedule_slack_days || overview.schedule_slack_days <= 15) && (
                            <div className="text-slate-500 text-xs py-4 text-center uppercase tracking-widest">No active warnings flagged</div>
                          )}
                        </div>
                      </div>

                      {/* Risk Flags & Velocity */}
                      <div className="space-y-4">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block">Risk Matrix Flags & Forecast</span>
                        <div className="space-y-3">
                          <div className="space-y-2">
                            <p className={`flex items-center gap-2 font-bold ${Number(overrunPct) > 0 ? 'text-rose-400' : 'text-slate-500'}`}>
                              <span>{Number(overrunPct) > 0 ? '🔴' : '⚪'}</span> Budget Overrun Anomaly
                            </p>
                            <p className={`flex items-center gap-2 font-bold ${overview.schedule_slack_days > 15 ? 'text-rose-400' : 'text-slate-500'}`}>
                              <span>{overview.schedule_slack_days > 15 ? '🔴' : '⚪'}</span> Timeline Schedule Delay
                            </p>
                            <p className={`flex items-center gap-2 font-bold ${overview.days_since_last_report > 7 ? 'text-rose-400' : 'text-slate-500'}`}>
                              <span>{overview.days_since_last_report > 7 ? '🔴' : '⚪'}</span> Report Submission Lag
                            </p>
                          </div>
                          
                          <div className="glass-panel p-4 rounded-xl bg-white/[0.01] space-y-1.5 mt-4">
                            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 block">Project Forecast Velocity</span>
                            <div className="text-slate-300 font-bold">
                              {overview.physical_progress > 0 
                                ? 'Reporting steady progress rate' 
                                : 'Awaiting progress reporting setup'}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 5. Activity & Audit Logs Tab */}
                {activeTab === 'logs' && (
                  <div className="space-y-6">
                    <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 border-b border-white/5 pb-2">Activity & Audit Center</h2>
                    
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 text-xs">
                      {/* SLA Approvals */}
                      <div className="space-y-4">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block">Review Process SLAs</span>
                        {approvals.length === 0 ? (
                          <div className="text-slate-500 text-xs py-10 text-center uppercase tracking-widest">No approval logs mapping this project</div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse text-xs">
                              <thead>
                                <tr className="border-b border-white/5 pb-2 text-slate-500">
                                  <th className="py-2">Approval Stage</th>
                                  <th className="py-2 text-center">Duration Hours</th>
                                  <th className="py-2 text-right">SLA Breach</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-white/5">
                                {approvals.map((row, idx) => (
                                  <tr key={idx} className="hover:bg-white/5 transition-colors">
                                    <td className="py-3 font-bold text-slate-200">{row.stage}</td>
                                    <td className="py-3 text-center text-slate-300 font-mono">{Number(row.duration_hours || 0).toFixed(1)}h</td>
                                    <td className="py-3 text-right">
                                      <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase ${
                                        row.is_violated ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                      }`}>
                                        {row.is_violated ? 'Breached' : 'Within Limit'}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>

                      {/* Audit Logs */}
                      <div className="space-y-4">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block">System Change Logs</span>
                        {audits.length === 0 ? (
                          <div className="text-slate-500 text-xs py-10 text-center uppercase tracking-widest">No logs registered for this project scope</div>
                        ) : (
                          <div className="space-y-4 max-h-[360px] overflow-y-auto no-scrollbar pr-2">
                            {audits.map((log, idx) => (
                              <div key={idx} className="relative pl-6 border-l border-white/10 pb-2">
                                <span className="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-indigo-500" />
                                <div className="flex flex-col gap-1 text-[11px] leading-relaxed">
                                  <span className="text-slate-300">
                                    <strong className="text-slate-200">{log.user_name || 'System'}</strong> performing <span className="font-bold text-amber-500">{log.action}</span> on <span className="text-slate-200">{log.module_name}</span> (ID: <span className="font-mono text-slate-400">{log.record_identifier}</span>)
                                  </span>
                                  <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">
                                    {log.timestamp ? new Date(log.timestamp).toLocaleString('en-IN') : ''}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

              </div>

            </div>
          )}
    </>
  );
};

export default ProjectDigitalTwin;
