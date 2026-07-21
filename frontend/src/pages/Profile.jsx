import React, { useState, useEffect } from 'react';
import authApi from '../api/authApi';

const Profile = () => {
  const [profile, setProfile] = useState(null);
  const [roleData, setRoleData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pageTransactions, setPageTransactions] = useState(1);
  const txPageSize = 5;

  useEffect(() => {
    const fetchProfile = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await authApi.get('/profile');
        if (response.data?.success) {
          setProfile(response.data.profile);
          setRoleData(response.data.roleData);
        }
      } catch (err) {
        console.error('Error fetching profile data:', err);
        setError(err.response?.data?.message || 'Failed to fetch profile details.');
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, []);

  const formatCurrency = (amt) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2
    }).format(amt);
  };

  return (
    <>
          {/* Header Section */}
          <div className="mb-8 pb-6 border-b border-white/5">
            <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500">My Account</span>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">User Profile</h1>
            <p className="text-xs text-slate-400 font-medium mt-1.5">
              View and manage your identity, assignments, and performance metrics.
            </p>
          </div>

          {error && (
            <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium flex items-center justify-between">
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="space-y-8 animate-pulse">
              {/* Profile Card Skeleton */}
              <div className="glass-panel p-6 rounded-3xl flex flex-col md:flex-row items-center gap-6">
                <div className="w-20 h-20 rounded-2xl bg-white/10 shrink-0" />
                <div className="flex-1 space-y-3 w-full">
                  <div className="h-6 w-48 bg-white/10 rounded-lg" />
                  <div className="h-4 w-32 bg-white/5 rounded-md" />
                  <div className="flex gap-4 pt-2">
                    <div className="h-4 w-24 bg-white/5 rounded-md" />
                    <div className="h-4 w-28 bg-white/5 rounded-md" />
                  </div>
                </div>
              </div>

              {/* Stats Grid Skeleton */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="glass-panel p-5 rounded-2xl space-y-3">
                    <div className="h-3 w-20 bg-white/10 rounded" />
                    <div className="h-7 w-16 bg-white/10 rounded-lg" />
                  </div>
                ))}
              </div>

              {/* 3-Column Control Room Cards Skeleton */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="glass-panel p-6 rounded-3xl h-[520px] flex flex-col justify-between">
                    <div className="h-5 w-36 bg-white/10 rounded-lg mb-6" />
                    <div className="space-y-4 flex-1">
                      {[1, 2, 3, 4].map((j) => (
                        <div key={j} className="h-16 bg-white/5 rounded-2xl" />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : !profile ? (
            <div className="text-center text-slate-500 py-12">No profile data available.</div>
          ) : (
            <div className="space-y-8 animate-fadeIn">
              
              {/* Profile Card */}
              <div className="glass-panel p-6 rounded-3xl flex flex-col md:flex-row items-center gap-6 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />
                
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-amber-500 to-indigo-500 flex items-center justify-center font-black text-slate-950 text-3xl select-none shadow-lg">
                  {profile.display_name ? profile.display_name[0].toUpperCase() : 'U'}
                </div>

                <div className="flex-grow text-center md:text-left">
                  <div className="flex flex-col md:flex-row md:items-center gap-2 justify-center md:justify-start">
                    <h2 className="text-xl font-bold text-slate-100">{profile.display_name}</h2>
                    <span className="inline-block w-fit mx-auto md:mx-0 px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      {profile.role}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 font-medium mt-1">Phone: {profile.mobile_number}</p>
                  
                  <div className="mt-4 flex flex-wrap gap-2 justify-center md:justify-start">
                    {profile.role === 'je' && (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-[10px] font-semibold uppercase tracking-wider bg-orange-500/10 text-orange-400 border border-orange-500/20">
                        <span>🔥</span>
                        <span>{profile.daily_streak || 0} Day Streak</span>
                      </span>
                    )}

                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-[10px] font-semibold uppercase tracking-wider ${
                      profile.is_active 
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                        : 'bg-red-500/10 text-red-400 border border-red-500/20'
                    }`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${profile.is_active ? 'bg-emerald-400' : 'bg-red-400'}`} />
                      {profile.is_active ? 'Account Active' : 'Account Inactive'}
                    </span>

                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-[10px] font-semibold uppercase tracking-wider ${
                      profile.telegram_chat_id 
                        ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' 
                        : 'bg-amber-500/10 text-amber-500 border border-amber-500/20 animate-pulse'
                    }`}>
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15.75-.8 3.51-1.12 4.79-.14.54-.34.72-.43.73-.2.02-.35-.13-.55-.26-.3-.21-.47-.32-.76-.51-.34-.23-.12-.35.07-.55.05-.05.94-.87.96-.95.002-.01.002-.04-.01-.05-.01-.01-.04-.01-.06.00-.03.01-.48.31-1.37.91-.13.09-.25.13-.36.13-.12-.01-.35-.07-.52-.13-.21-.07-.38-.11-.36-.23.01-.06.1-.12.26-.19 1.01-.44 1.68-.73 2.01-.87 1.92-.81 2.32-.95 2.58-.95.06 0 .19.01.27.08.07.06.09.14.1.22-.01.04-.01.12-.02.19z"/>
                      </svg>
                      {profile.telegram_chat_id ? `Telegram ID: ${profile.telegram_chat_id}` : 'Telegram Setup Needed'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Role-Specific panels */}
              
              {/* JUNIOR ENGINEER PANEL */}
              {profile.role === 'je' && roleData && (
                <div className="space-y-8">
                  {/* Stats Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="glass-panel p-5 rounded-2xl flex flex-col justify-between">
                      <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400">Total Progress Reports</span>
                      <span className="text-3xl font-extrabold text-slate-100 mt-2">{roleData.stats?.totalReports || 0}</span>
                    </div>
                    <div className="glass-panel p-5 rounded-2xl flex flex-col justify-between">
                      <span className="text-[10px] uppercase font-bold tracking-widest text-emerald-400">Approved Estimates</span>
                      <span className="text-3xl font-extrabold text-emerald-400 mt-2">{roleData.stats?.approvedCount || 0}</span>
                    </div>
                    <div className="glass-panel p-5 rounded-2xl flex flex-col justify-between">
                      <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500">Pending Review</span>
                      <span className="text-3xl font-extrabold text-amber-500 mt-2">{roleData.stats?.pendingCount || 0}</span>
                    </div>
                  </div>

                  {/* Mapping & Work Orders */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Zone Officer Mapping Card */}
                    <div className="glass-panel p-6 rounded-3xl h-fit">
                      <h3 className="text-sm uppercase font-bold tracking-widest text-slate-400 mb-4 border-b border-white/5 pb-2">Assigned Zonal Office</h3>
                      {roleData.zoDetails ? (
                        <div className="space-y-3">
                          <div>
                            <div className="text-[10px] text-slate-500 font-bold uppercase">Officer Name</div>
                            <div className="text-sm font-bold text-slate-100">{roleData.zoDetails.display_name}</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-slate-500 font-bold uppercase">Contact Number</div>
                            <div className="text-sm font-semibold text-slate-300">{roleData.zoDetails.mobile_number}</div>
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-amber-500 font-medium">No active Zonal Office assignment.</div>
                      )}
                    </div>

                    {/* Active Work Orders */}
                    <div className="glass-panel p-6 rounded-3xl lg:col-span-2">
                      <h3 className="text-sm uppercase font-bold tracking-widest text-slate-400 mb-4 border-b border-white/5 pb-2">Assigned Work Orders</h3>
                      {roleData.workOrders?.length > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs border-collapse">
                            <thead>
                              <tr className="text-[10px] text-slate-500 uppercase tracking-wider border-b border-white/5">
                                <th className="pb-2">Work Order No</th>
                                <th className="pb-2">Zonal Office</th>
                                <th className="pb-2">Dept</th>
                                <th className="pb-2">Zone/District</th>
                                <th className="pb-2">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5 text-slate-300">
                              {roleData.workOrders.map((wo) => (
                                <tr key={wo.work_order_no}>
                                  <td className="py-2.5 font-bold text-slate-100">{wo.work_order_no}</td>
                                  <td className="py-2.5 text-slate-200">{roleData.zoDetails?.display_name || '—'}</td>
                                  <td className="py-2.5">{wo.department}</td>
                                  <td className="py-2.5">{wo.zone} / {wo.district}</td>
                                  <td className="py-2.5">
                                    <span className="inline-block px-2 py-0.5 rounded-full text-[8px] font-bold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                      {wo.status}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="text-xs text-slate-500 py-4">No active work orders assigned.</div>
                      )}
                    </div>
                  </div>

                  {/* Recent daily progress submissions */}
                  <div className="glass-panel p-6 rounded-3xl">
                    <h3 className="text-sm uppercase font-bold tracking-widest text-slate-400 mb-4 border-b border-white/5 pb-2">Recent Daily Progress Reports</h3>
                    {roleData.recentReports?.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="text-[10px] text-slate-500 uppercase tracking-wider border-b border-white/5">
                              <th className="pb-2">Site Visit Date</th>
                              <th className="pb-2">Work Order No</th>
                              <th className="pb-2">Physical Progress</th>
                              <th className="pb-2">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5 text-slate-300">
                            {roleData.recentReports.map((report) => (
                              <tr key={report.report_id}>
                                <td className="py-2.5 font-bold text-slate-100">
                                  {new Date(report.site_visit_date).toLocaleDateString('en-IN', { timeZone: 'UTC' })}
                                </td>
                                <td className="py-2.5">{report.work_order_no}</td>
                                <td className="py-2.5 font-semibold text-amber-500">{report.physical_work_progress}%</td>
                                <td className="py-2.5">
                                  <span className={`inline-block px-2 py-0.5 rounded-full text-[8px] font-bold uppercase ${
                                    report.approval_status === 'Approved' 
                                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                                      : report.approval_status === 'Rejected'
                                      ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                                      : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                  }`}>
                                    {report.approval_status === 'Approved' ? 'Approved' : report.approval_status === 'Rejected' ? 'Rejected' : 'Pending Review'}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="text-xs text-slate-500 py-4">No progress reports submitted yet.</div>
                    )}
                  </div>
                </div>
              )}

              {/* ZONAL OFFICER PANEL */}
              {profile.role === 'zo' && roleData && (
                <div className="space-y-8">
                  {/* Unified Zonal Dashboard Grid */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    
                    {/* Column 1: Balance & Ledger */}
                    <div className="space-y-6">
                      {/* Available Balance */}
                      <div className="glass-panel p-6 rounded-3xl bg-gradient-to-tr from-slate-900 to-amber-950/20 border border-amber-500/20 shadow-lg flex flex-col justify-between">
                        <div>
                          <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500">Available Balance</span>
                          <h2 className="text-2xl font-black text-amber-400 mt-2">{formatCurrency(roleData.balance || 0)}</h2>
                        </div>
                        <p className="text-[9px] text-slate-400 mt-4 uppercase font-bold">Zonal Ledger balance</p>
                      </div>

                      {/* Recent Fund Ledger Entries */}
                      <div className="glass-panel p-6 rounded-3xl">
                        <h3 className="text-xs uppercase font-bold tracking-widest text-slate-400 mb-4 border-b border-white/5 pb-2">Recent Fund Ledger</h3>
                        {roleData.recentTransactions?.length > 0 ? (
                          <div className="max-h-56 overflow-y-auto no-scrollbar space-y-3">
                            {roleData.recentTransactions.map((tx) => (
                              <div key={tx.ledger_id} className="flex justify-between items-center p-2.5 rounded-2xl bg-white/2 border border-white/5">
                                <div className="truncate">
                                  <div className="text-[11px] font-bold text-slate-200 truncate">{tx.transaction_type}</div>
                                  <div className="text-[9px] text-slate-500 mt-0.5">
                                    {new Date(tx.created_at).toLocaleDateString('en-IN')}
                                  </div>
                                </div>
                                <span className={`text-[11px] font-bold shrink-0 ml-2 ${
                                  ['ALLOCATION', 'RETURN'].includes(tx.transaction_type) ? 'text-emerald-400' : 'text-rose-400'
                                }`}>
                                  {['ALLOCATION', 'RETURN'].includes(tx.transaction_type) ? '+' : '-'} {formatCurrency(tx.amount)}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-xs text-slate-500 py-4 text-center">No ledger transactions found.</div>
                        )}
                      </div>
                    </div>                    {/* Column 2: Connected Junior Engineers & Work Orders */}
                    <div className="glass-panel p-6 rounded-3xl">
                      <h3 className="text-sm uppercase font-bold tracking-widest text-slate-400 mb-4 border-b border-white/5 pb-2">Connected JEs & Work Orders</h3>
                      {roleData.jes?.length > 0 ? (
                        <div className="space-y-4 max-h-[350px] overflow-y-auto pr-1 no-scrollbar">
                          {roleData.jes.map((je) => {
                            const jeWOs = roleData.jeMappings?.filter(m => m.je_user_id === je.mobile_number) || [];
                            return (
                              <div key={je.mobile_number} className="p-3.5 rounded-2xl bg-white/2 border border-white/5 hover:border-white/10 transition-all duration-300">
                                <div className="flex justify-between items-start">
                                  <div>
                                    <div className="font-bold text-xs text-slate-200">{je.display_name}</div>
                                    <div className="text-[10px] text-slate-500 mt-0.5">{je.mobile_number}</div>
                                  </div>
                                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider ${
                                    je.is_active
                                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                      : 'bg-red-500/10 text-red-400 border border-red-500/20'
                                  }`}>
                                    {je.is_active ? 'Active' : 'Inactive'}
                                  </span>
                                </div>
                                <div className="mt-3">
                                  <div className="text-[9px] uppercase font-bold tracking-widest text-slate-500 mb-1.5">Assigned Work Orders</div>
                                  {jeWOs.length > 0 ? (
                                    <div className="flex flex-wrap gap-1.5">
                                      {jeWOs.map((wo) => (
                                        <span key={wo.work_order_no} className="px-2 py-0.5 rounded-lg bg-slate-900 border border-white/5 text-[10px] font-mono text-slate-300">
                                          {wo.work_order_no}
                                        </span>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="text-[10px] text-slate-600 italic">No assigned work orders.</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="text-xs text-slate-500 py-4 text-center">No Junior Engineers mapped.</div>
                      )}
                    </div>

                    {/* Column 3: Owned Projects */}
                    <div className="glass-panel p-6 rounded-3xl">
                      <h3 className="text-sm uppercase font-bold tracking-widest text-slate-400 mb-4 border-b border-white/5 pb-2">Owned Projects</h3>
                      {roleData.workOrders?.length > 0 ? (
                        <div className="max-h-[350px] overflow-y-auto no-scrollbar space-y-3">
                          {roleData.workOrders.map((wo) => (
                            <div key={wo.work_order_no} className="p-3.5 rounded-2xl bg-white/2 border border-white/5">
                              <div className="flex justify-between items-start">
                                <span className="font-bold text-xs text-slate-200">{wo.work_order_no}</span>
                                <span className="text-[8px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/20">
                                  {wo.status}
                                </span>
                              </div>
                              <p className="text-[10px] text-slate-400 mt-1 truncate">{wo.site_details}</p>
                              <div className="text-[9px] text-slate-500 mt-2 font-semibold">
                                {wo.department} | {wo.district}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-slate-500 py-4">No projects mapped.</div>
                      )}
                    </div>

                  </div>
                </div>
              )}

              {/* HO / ADMIN CONTROL ROOM PANEL */}
              {(profile.role === 'ho' || profile.role === 'admin') && roleData && (
                <AdminControlRoom 
                  roleData={roleData} 
                  formatCurrency={formatCurrency} 
                  pageTransactions={pageTransactions}
                  setPageTransactions={setPageTransactions}
                  txPageSize={txPageSize}
                />
              )}
            </div>
          )}
    </>
  );
};
const AdminControlRoom = ({ roleData, formatCurrency, pageTransactions, setPageTransactions, txPageSize }) => {
  const [filterType, setFilterType] = useState('value'); // 'value', 'progress', 'physical_progress', 'requisitions_spend', 'progress_activity'

  const getSortedProjects = () => {
    const projects = [...(roleData.enrichedProjects || [])];
    if (filterType === 'value') {
      return projects.sort((a, b) => b.work_order_value - a.work_order_value).slice(0, 5);
    } else if (filterType === 'progress') {
      return projects.sort((a, b) => b.estimate_sheets_count - a.estimate_sheets_count).slice(0, 5);
    } else if (filterType === 'physical_progress') {
      return projects.sort((a, b) => b.max_physical_progress - a.max_physical_progress).slice(0, 5);
    } else if (filterType === 'requisitions_spend') {
      return projects.sort((a, b) => b.requisitions_total_amount - a.requisitions_total_amount).slice(0, 5);
    } else if (filterType === 'progress_activity') {
      return projects.sort((a, b) => b.progress_reports_count - a.progress_reports_count).slice(0, 5);
    }
    return projects.slice(0, 5);
  };

  const top5Projects = getSortedProjects();

  return (
    <div className="space-y-8">
      {/* System statistics grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="glass-panel p-5 rounded-2xl border-l-4 border-l-amber-500">
          <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400">Total Users</span>
          <div className="text-3xl font-extrabold text-slate-100 mt-2">{roleData.stats?.totalUsers || 0}</div>
        </div>
        <div className="glass-panel p-5 rounded-2xl border-l-4 border-l-blue-500">
          <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400">Total Projects</span>
          <div className="text-3xl font-extrabold text-slate-100 mt-2">{roleData.stats?.totalProjects || 0}</div>
        </div>
        <div className="glass-panel p-5 rounded-2xl border-l-4 border-l-emerald-500">
          <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400">Active Mappings</span>
          <div className="text-3xl font-extrabold text-slate-100 mt-2">{roleData.stats?.activeMappings || 0}</div>
        </div>
        <div className="glass-panel p-5 rounded-2xl border-l-4 border-l-indigo-500">
          <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500">Zonal Balances Total</span>
          <div className="text-xl font-bold text-amber-500 mt-3 truncate" title={formatCurrency(roleData.stats?.totalZonalBalances || 0)}>
            {formatCurrency(roleData.stats?.totalZonalBalances || 0)}
          </div>
        </div>
      </div>
      {/* Control Room Layout Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-stretch">
        
        {/* Card 1: Ongoing Work Zones */}
        <div className="glass-panel p-6 rounded-3xl relative overflow-hidden flex flex-col justify-between h-[520px]">
          <div className="absolute top-0 right-0 w-48 h-48 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-4 mb-4 shrink-0">
              <div>
                <h3 className="text-sm uppercase font-bold tracking-widest text-slate-300">Ongoing Work Zones</h3>
                <p className="text-[10px] text-slate-500 font-medium">Top 5 priority work orders</p>
              </div>
              <div>
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="bg-slate-200 dark:bg-neutral-950 border border-slate-300 dark:border-white/10 rounded-xl px-2 py-1 text-[10px] text-slate-800 dark:text-slate-200 focus:outline-none w-full"
                >
                  <option value="value" className="bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100">Highest Value</option>
                  <option value="progress" className="bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100">Most Estimates</option>
                  <option value="physical_progress" className="bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100">Highest Completion</option>
                  <option value="requisitions_spend" className="bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100">Highest Spend</option>
                  <option value="progress_activity" className="bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100">Most Active Reports</option>
                </select>
              </div>
            </div>

            {top5Projects.length > 0 ? (
              <div className="space-y-3.5 flex-1 overflow-y-auto no-scrollbar pr-1">
                {top5Projects.map((p) => (
                  <div key={p.work_order_no} className="p-3 rounded-2xl bg-white/2 border border-white/5 hover:border-white/10 transition-all duration-300">
                    <div className="flex justify-between items-start gap-2">
                      <div className="truncate">
                        <div className="font-bold text-xs text-slate-100 truncate">{p.work_order_no}</div>
                        <div className="text-[10px] text-slate-500 font-medium truncate mt-0.5">{p.site_details}</div>
                      </div>
                      <div className="text-right shrink-0">
                        {filterType === 'value' && <div className="text-xs font-bold text-amber-500">{formatCurrency(p.work_order_value || 0)}</div>}
                        {filterType === 'progress' && <div className="text-xs font-bold text-sky-400">{p.estimate_sheets_count || 0} Estimates</div>}
                        {filterType === 'physical_progress' && <div className="text-xs font-bold text-emerald-400">{p.max_physical_progress || 0}% Done</div>}
                        {filterType === 'requisitions_spend' && <div className="text-xs font-bold text-indigo-400">{formatCurrency(p.requisitions_total_amount || 0)}</div>}
                        {filterType === 'progress_activity' && <div className="text-xs font-bold text-sky-400">{p.progress_reports_count || 0} Reports</div>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-500 py-6 text-center">No project records found.</div>
            )}
          </div>
        </div>

        {/* Card 2: Cash Distribution Breakdown */}
        <div className="glass-panel p-6 rounded-3xl relative overflow-hidden flex flex-col justify-between h-[520px]">
          <div className="absolute top-0 right-0 w-48 h-48 bg-emerald-500/5 dark:bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="flex-1 flex flex-col">
            <div className="flex justify-between items-center mb-4 border-b border-slate-200 dark:border-white/5 pb-2 shrink-0">
              <h3 className="text-sm uppercase font-extrabold tracking-widest text-black dark:text-slate-100" style={{ color: 'var(--title-color, inherit)' }}>
                Cash Distribution Breakdown
              </h3>
            </div>

            {roleData.capitalFlow ? (
              <div className="space-y-4 flex-1 flex flex-col justify-start">
                {/* In-Flight (Awaiting Clearances) */}
                <div className="p-4 rounded-2xl bg-amber-500/10 dark:bg-amber-500/10 border border-amber-500/20 dark:border-amber-500/20 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)] shrink-0" />
                    <div>
                      <div className="text-xs uppercase font-bold tracking-wider text-slate-800 dark:text-slate-200">In-Flight / Pending Approvals</div>
                      <div className="text-[10px] text-slate-600 dark:text-slate-400 font-medium mt-0.5">Fund requests & pending requisitions</div>
                    </div>
                  </div>
                  <div className="text-base font-extrabold text-amber-700 dark:text-amber-400 font-mono shrink-0">
                    {formatCurrency(roleData.capitalFlow.inFlight?.total || 0)}
                  </div>
                </div>

                {/* Capital Moved (30-Day Velocity) */}
                <div className="p-4 rounded-2xl bg-emerald-500/10 dark:bg-emerald-500/10 border border-emerald-500/20 dark:border-emerald-500/20 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] shrink-0" />
                    <div>
                      <div className="text-xs uppercase font-bold tracking-wider text-slate-800 dark:text-slate-200">Capital Moved (30 Days)</div>
                      <div className="text-[10px] text-slate-600 dark:text-slate-400 font-medium mt-0.5">Disbursed to ZO and Field accounts</div>
                    </div>
                  </div>
                  <div className="text-base font-extrabold text-emerald-700 dark:text-emerald-400 font-mono shrink-0">
                    {formatCurrency(roleData.capitalFlow.recentMoved?.total || 0)}
                  </div>
                </div>

                {/* Hierarchy Flow Visual Bar */}
                <div className="p-4 rounded-2xl bg-white/40 dark:bg-white/5 border border-slate-200 dark:border-white/5 space-y-3 mt-auto">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-300">Capital Velocity Pipeline</div>
                  
                  <div className="space-y-3">
                    {/* ZO Allocations Sub-bar */}
                    <div>
                      <div className="flex justify-between items-center text-[10px] mb-1">
                        <span className="font-semibold text-slate-700 dark:text-slate-300">Zonal Office Disbursals</span>
                        <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                          {formatCurrency(roleData.capitalFlow.recentMoved?.zonalAllocations || 0)}
                        </span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-slate-300 dark:bg-white/10 overflow-hidden">
                        <div 
                          className="h-full bg-emerald-500 transition-all duration-500 rounded-full" 
                          style={{ 
                            width: `${roleData.capitalFlow.recentMoved?.total > 0 
                              ? Math.min(100, Math.max(5, (roleData.capitalFlow.recentMoved.zonalAllocations / roleData.capitalFlow.recentMoved.total) * 100)) 
                              : 0}%` 
                          }} 
                        />
                      </div>
                    </div>

                    {/* JE Requisitions Sub-bar */}
                    <div>
                      <div className="flex justify-between items-center text-[10px] mb-1">
                        <span className="font-semibold text-slate-700 dark:text-slate-300">Site Requisitions Paid</span>
                        <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                          {formatCurrency(roleData.capitalFlow.recentMoved?.requisitionsDisbursed || 0)}
                        </span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-slate-300 dark:bg-white/10 overflow-hidden">
                        <div 
                          className="h-full bg-sky-500 transition-all duration-500 rounded-full" 
                          style={{ 
                            width: `${roleData.capitalFlow.recentMoved?.total > 0 
                              ? Math.min(100, Math.max(5, (roleData.capitalFlow.recentMoved.requisitionsDisbursed / roleData.capitalFlow.recentMoved.total) * 100)) 
                              : 0}%` 
                          }} 
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-xs text-slate-500 py-4 text-center">No capital flow metrics available.</div>
            )}
          </div>
        </div>

        {/* Card 3: My Recent Actions */}
        <div className="glass-panel p-6 rounded-3xl relative overflow-hidden flex flex-col justify-between h-[520px]">
          <div className="absolute top-0 right-0 w-48 h-48 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />
          <div className="flex-1 flex flex-col overflow-hidden">
            <h3 className="text-sm uppercase font-bold tracking-widest text-slate-300 mb-4 border-b border-white/5 pb-2 shrink-0">My Recent Actions</h3>
            {roleData.recentActions?.length > 0 ? (
              <div className="space-y-3 flex-1 overflow-y-auto no-scrollbar pr-1">
                {roleData.recentActions.map((log) => (
                  <div key={log.id} className="p-3 rounded-2xl bg-white/2 border border-white/5 hover:border-white/10 transition">
                    <div className="flex justify-between items-start">
                      <span className="text-[10px] font-extrabold text-amber-500 uppercase tracking-widest">{log.action}</span>
                      <span className="text-[9px] text-slate-500 font-semibold">
                        {new Date(log.timestamp).toLocaleDateString('en-IN')}
                      </span>
                    </div>
                    <div className="text-xs font-bold text-slate-300 mt-1">{log.module_name}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5 truncate">ID: {log.record_identifier}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-500 py-4 text-center">No recent actions logged.</div>
            )}
          </div>
        </div>

      </div>

      {/* Bottom Section: Unified Transactions Feed */}
      <div className="mt-8">
        <div className="glass-panel p-6 rounded-3xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-48 h-48 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />
          <div className="flex justify-between items-center mb-4 border-b border-white/5 pb-2">
            <h3 className="text-sm uppercase font-bold tracking-widest text-slate-300">Latest System Transactions</h3>
            {roleData.latestTransactions?.length > txPageSize && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400 font-medium">
                  Page {pageTransactions} of {Math.ceil(roleData.latestTransactions.length / txPageSize)}
                </span>
                <button
                  onClick={() => setPageTransactions((p) => Math.max(1, p - 1))}
                  disabled={pageTransactions === 1}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition ${
                    pageTransactions === 1
                      ? 'bg-white/5 text-slate-600 cursor-not-allowed'
                      : 'bg-white/10 text-slate-200 hover:bg-white/20'
                  }`}
                >
                  Prev
                </button>
                <button
                  onClick={() =>
                    setPageTransactions((p) =>
                      p * txPageSize < roleData.latestTransactions.length ? p + 1 : p
                    )
                  }
                  disabled={pageTransactions * txPageSize >= roleData.latestTransactions.length}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition ${
                    pageTransactions * txPageSize >= roleData.latestTransactions.length
                      ? 'bg-white/5 text-slate-600 cursor-not-allowed'
                      : 'bg-white/10 text-slate-200 hover:bg-white/20'
                  }`}
                >
                  Next
                </button>
              </div>
            )}
          </div>
          {roleData.latestTransactions?.length > 0 ? (
            <div className="space-y-3">
              {roleData.latestTransactions
                .slice((pageTransactions - 1) * txPageSize, pageTransactions * txPageSize)
                .map((tx, idx) => (
                  <div key={idx} className="flex justify-between items-center p-3 rounded-2xl bg-white/2 border border-white/5 hover:bg-white/4 transition">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-slate-100">{tx.identifier}</span>
                        <span className={`text-[8px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                          tx.type === 'Fund Request' 
                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' 
                            : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                        }`}>
                          {tx.type}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-1">
                        {new Date(tx.date).toLocaleDateString('en-IN')} @ {new Date(tx.date).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs font-bold text-slate-200">{formatCurrency(tx.amount)}</div>
                      <span className={`inline-block text-[8px] font-extrabold uppercase mt-1 tracking-widest ${
                        ['Approved', 'Completed'].includes(tx.status)
                          ? 'text-emerald-400'
                          : ['Pending'].includes(tx.status)
                          ? 'text-amber-500 animate-pulse'
                          : 'text-slate-500'
                      }`}>
                        {tx.status}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <div className="text-xs text-slate-500 py-6 text-center">No transaction records found.</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Profile;
