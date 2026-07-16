import React, { useState, useEffect } from 'react';
import { useAuth } from '../components/AuthContext';
import BackgroundShapes from '../components/BackgroundShapes';
import Sidebar, { MobileHeader } from '../components/Sidebar';
import TopNavbar from '../components/TopNavbar';
import authApi from '../api/authApi';

const Profile = () => {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [roleData, setRoleData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
    <div className="h-screen bg-black text-slate-100 flex flex-col md:flex-row font-sans relative overflow-hidden">
      <BackgroundShapes />
      <Sidebar />
      <MobileHeader />

      <div className="flex-grow flex flex-col min-w-0 overflow-hidden">
        <TopNavbar />
        <main className="flex-grow p-6 md:p-10 overflow-y-auto no-scrollbar max-w-7xl mx-auto w-full relative z-10">
          
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
            <div className="py-12 text-center text-slate-500">
              <span className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-amber-500 mr-2" />
              <p className="mt-2 text-xs">Loading profile dashboard...</p>
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
                                <th className="pb-2">Dept</th>
                                <th className="pb-2">Zone/District</th>
                                <th className="pb-2">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5 text-slate-300">
                              {roleData.workOrders.map((wo) => (
                                <tr key={wo.work_order_no}>
                                  <td className="py-2.5 font-bold text-slate-100">{wo.work_order_no}</td>
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
                                    report.approved_user_id 
                                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                                      : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                  }`}>
                                    {report.approved_user_id ? 'Approved' : 'Pending Review'}
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
                    </div>

                    {/* Column 2: Mapped Junior Engineers Tree */}
                    <div className="glass-panel p-6 rounded-3xl">
                      <h3 className="text-sm uppercase font-bold tracking-widest text-slate-400 mb-4 border-b border-white/5 pb-2">Mapped Junior Engineers</h3>
                      
                      {roleData.workOrders?.length > 0 ? (
                        <div className="space-y-4 max-h-[350px] overflow-y-auto pr-1 no-scrollbar">
                          {roleData.workOrders.map((wo) => {
                            // Find JEs mapped to this specific work order
                            const mappedJEs = roleData.jeMappings?.filter(m => m.work_order_no === wo.work_order_no) || [];
                            
                            return (
                              <div key={wo.work_order_no} className="relative pl-3 border-l border-dashed border-white/10 space-y-2">
                                {/* Root node of the tree: Work Order */}
                                <div className="flex items-center gap-2 p-2 rounded-xl bg-white/2 border border-white/5 relative">
                                  {/* Dot indicator on the connection line */}
                                  <div className="absolute -left-[17px] top-4.5 w-2 h-2 rounded-full bg-slate-900 border border-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.4)] z-10" />
                                  <div className="truncate">
                                    <div className="text-[10px] font-black text-slate-200">{wo.work_order_no}</div>
                                    <div className="text-[9px] text-slate-400 truncate">{wo.site_details}</div>
                                  </div>
                                </div>

                                {/* Child nodes: Mapped JEs */}
                                <div className="pl-4 space-y-2 relative">
                                  {mappedJEs.length > 0 ? (
                                    mappedJEs.map((je) => (
                                      <div key={je.mobile_number} className="flex items-center gap-2 p-1.5 rounded-lg bg-white/2 border border-white/5 relative">
                                        {/* Connector branch line */}
                                        <div className="absolute -left-4 top-3 w-4 h-0.5 border-t border-dashed border-white/20" />
                                        <div className="truncate">
                                          <div className="text-[10px] font-bold text-slate-300 truncate">{je.display_name}</div>
                                          <div className="text-[8px] text-slate-500">{je.mobile_number}</div>
                                        </div>
                                      </div>
                                    ))
                                  ) : (
                                    <div className="flex items-center gap-1 text-[9px] text-slate-500 pl-1">
                                      <div className="absolute -left-4 top-2 w-4 h-0.5 border-t border-dashed border-white/10" />
                                      No JEs mapped.
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="text-xs text-slate-500 py-4">No active work orders mapped.</div>
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
                <AdminControlRoom roleData={roleData} formatCurrency={formatCurrency} />
              )}

            </div>
          )}

        </main>
      </div>
    </div>
  );
};
const AdminControlRoom = ({ roleData, formatCurrency }) => {
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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column: Ongoing Tasks, Flow Board & Transactions Feed */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* Side by side grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            
            {/* Ongoing Task Control Panel */}
            <div className="glass-panel p-6 rounded-3xl relative overflow-hidden flex flex-col justify-between">
              <div className="absolute top-0 right-0 w-48 h-48 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-4 mb-4">
                  <div>
                    <h3 className="text-sm uppercase font-bold tracking-widest text-slate-300">Ongoing Work Zones</h3>
                    <p className="text-[10px] text-slate-500 font-medium">Top 5 priority work orders</p>
                  </div>
                  <div>
                    <select
                      value={filterType}
                      onChange={(e) => setFilterType(e.target.value)}
                      className="bg-neutral-950 border border-white/10 rounded-xl px-2 py-1 text-[10px] text-slate-200 focus:outline-none w-full"
                    >
                      <option value="value">Highest Value</option>
                      <option value="progress">Most Estimates</option>
                      <option value="physical_progress">Highest Completion</option>
                      <option value="requisitions_spend">Highest Spend</option>
                      <option value="progress_activity">Most Active Reports</option>
                    </select>
                  </div>
                </div>

                {top5Projects.length > 0 ? (
                  <div className="space-y-3.5">
                    {top5Projects.map((p) => (
                      <div key={p.work_order_no} className="p-3 rounded-2xl bg-white/2 border border-white/5 hover:border-white/10 transition-all duration-300">
                        <div className="flex justify-between items-start gap-2">
                          <div className="truncate">
                            <span className="font-extrabold text-xs text-slate-200">{p.work_order_no}</span>
                            <p className="text-[10px] text-slate-400 mt-1 truncate">{p.site_details}</p>
                          </div>
                          <div className="text-right shrink-0 font-medium">
                            {filterType === 'value' && (
                              <div className="text-xs font-bold text-amber-400">{formatCurrency(p.work_order_value)}</div>
                            )}
                            {filterType === 'progress' && (
                              <div className="text-xs font-bold text-indigo-400">{p.estimate_sheets_count} Sheets</div>
                            )}
                            {filterType === 'physical_progress' && (
                              <div className="text-xs font-bold text-emerald-400">{p.max_physical_progress}%</div>
                            )}
                            {filterType === 'requisitions_spend' && (
                              <div className="text-xs font-bold text-rose-400">{formatCurrency(p.requisitions_total_amount)}</div>
                            )}
                            {filterType === 'progress_activity' && (
                              <div className="text-xs font-bold text-sky-400">{p.progress_reports_count} Reports</div>
                            )}
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

            {/* Active Capital Flow Dashboard */}
            <div className="glass-panel p-6 rounded-3xl relative overflow-hidden flex flex-col justify-between">
              <div className="absolute top-0 right-0 w-48 h-48 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />
              <div>
                <h3 className="text-sm uppercase font-bold tracking-widest text-slate-300 mb-4 border-b border-white/5 pb-2">Active Capital Flow</h3>
                
                {roleData.capitalFlow ? (
                  <div className="space-y-4">
                    {/* In-Flight (Pending Clearance) */}
                    <div className="p-3 rounded-2xl bg-white/2 border border-white/5">
                      <span className="text-[9px] uppercase font-bold tracking-widest text-slate-500">In-Flight Funds</span>
                      <div className="text-lg font-black text-amber-500 mt-1">{formatCurrency(roleData.capitalFlow.inFlight?.total || 0)}</div>
                      <div className="w-full h-1 rounded-full bg-white/5 overflow-hidden flex mt-2">
                        <div 
                          className="h-full bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]" 
                          style={{ width: `${roleData.capitalFlow.inFlight?.total > 0 ? (roleData.capitalFlow.inFlight.fundRequests / roleData.capitalFlow.inFlight.total) * 100 : 50}%` }}
                        />
                        <div 
                          className="h-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]" 
                          style={{ width: `${roleData.capitalFlow.inFlight?.total > 0 ? (roleData.capitalFlow.inFlight.requisitions / roleData.capitalFlow.inFlight.total) * 100 : 50}%` }}
                        />
                      </div>
                    </div>

                    {/* Capital Moved */}
                    <div className="p-3 rounded-2xl bg-white/2 border border-white/5">
                      <span className="text-[9px] uppercase font-bold tracking-widest text-slate-500">Capital Moved (30d)</span>
                      <div className="text-lg font-black text-emerald-400 mt-1">{formatCurrency(roleData.capitalFlow.recentMoved?.total || 0)}</div>
                      <div className="w-full h-1 rounded-full bg-white/5 overflow-hidden flex mt-2">
                        <div 
                          className="h-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" 
                          style={{ width: `${roleData.capitalFlow.recentMoved?.total > 0 ? (roleData.capitalFlow.recentMoved.zonalAllocations / roleData.capitalFlow.recentMoved.total) * 100 : 50}%` }}
                        />
                        <div 
                          className="h-full bg-sky-500 shadow-[0_0_10px_rgba(14,165,233,0.5)]" 
                          style={{ width: `${roleData.capitalFlow.recentMoved?.total > 0 ? (roleData.capitalFlow.recentMoved.requisitionsDisbursed / roleData.capitalFlow.recentMoved.total) * 100 : 50}%` }}
                        />
                      </div>
                    </div>

                    {/* Capital Flow SVG Graph */}
                    <div className="p-3 rounded-2xl bg-black/40 border border-white/5 flex flex-col items-center">
                      <div className="w-full flex items-center justify-between relative px-2 py-1">
                        
                        <div className="flex flex-col items-center z-10">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-amber-500 to-amber-300 flex items-center justify-center text-slate-950 font-black text-[9px] shadow-[0_0_15px_rgba(245,158,11,0.2)] animate-pulse">
                            HO
                          </div>
                          <span className="text-[8px] text-slate-400 font-extrabold uppercase mt-1">HO</span>
                        </div>

                        <div className="absolute inset-x-0 top-4 h-8 pointer-events-none">
                          <svg className="w-full h-full" viewBox="0 0 200 40" preserveAspectRatio="xMidYMid meet">
                            <defs>
                              <linearGradient id="glowGrad1" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.2" />
                                <stop offset="50%" stopColor="#10b981" stopOpacity="0.8" />
                                <stop offset="100%" stopColor="#6366f1" stopOpacity="0.2" />
                              </linearGradient>
                            </defs>
                            <path d="M 30,15 L 90,15" stroke="rgba(255,255,255,0.06)" strokeWidth="3" fill="none" />
                            <path d="M 90,15 L 170,15" stroke="rgba(255,255,255,0.06)" strokeWidth="3" fill="none" />
                            <path 
                              d="M 30,15 L 90,15" 
                              stroke="url(#glowGrad1)" 
                              strokeWidth="1.5" 
                              fill="none" 
                              strokeDasharray="6 8" 
                              style={{ animation: 'dash 1.5s linear infinite' }}
                            />
                            <path 
                              d="M 90,15 L 170,15" 
                              stroke="url(#glowGrad1)" 
                              strokeWidth="1.5" 
                              fill="none" 
                              strokeDasharray="6 8" 
                              style={{ animation: 'dash 2s linear infinite' }}
                            />
                          </svg>
                        </div>

                        <div className="flex flex-col items-center z-10">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-emerald-500 to-emerald-300 flex items-center justify-center text-slate-950 font-black text-[9px] shadow-[0_0_15px_rgba(16,185,129,0.2)]">
                            ZO
                          </div>
                          <span className="text-[8px] text-slate-400 font-extrabold uppercase mt-1">ZO</span>
                        </div>

                        <div className="flex flex-col items-center z-10">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-indigo-300 flex items-center justify-center text-slate-950 font-black text-[9px] shadow-[0_0_15px_rgba(99,102,241,0.2)]">
                            JE
                          </div>
                          <span className="text-[8px] text-slate-400 font-extrabold uppercase mt-1">JE</span>
                        </div>

                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-slate-500 py-4 text-center">No capital flow metrics available.</div>
                )}
              </div>
            </div>

          </div>

          <style>{`
            @keyframes dash {
              to {
                stroke-dashoffset: -20;
              }
            }
          `}</style>

          {/* Unified Transactions Feed */}
          <div className="glass-panel p-6 rounded-3xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-48 h-48 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />
            <h3 className="text-sm uppercase font-bold tracking-widest text-slate-300 mb-4 border-b border-white/5 pb-2">Latest System Transactions</h3>
            {roleData.latestTransactions?.length > 0 ? (
              <div className="space-y-3">
                {roleData.latestTransactions.map((tx, idx) => (
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

        {/* Right Column: Audit Trail */}
        <div className="space-y-8">
          
          {/* Admin Recent Actions */}
          <div className="glass-panel p-6 rounded-3xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-48 h-48 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />
            <h3 className="text-sm uppercase font-bold tracking-widest text-slate-300 mb-4 border-b border-white/5 pb-2">My Recent Actions</h3>
            {roleData.recentActions?.length > 0 ? (
              <div className="space-y-3 max-h-80 overflow-y-auto no-scrollbar">
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
    </div>
  );
};

export default Profile;
