import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../components/AuthContext';
import authApi from '../../api/authApi';
import { getProgressReports } from '../../api/dailyProgressApi';
import { getUserMappings } from '../../api/userMappingsApi';
import { EMPTY_ARRAY } from '../../utils/constants';

const JeDashboardView = () => {
  const { user } = useAuth();

  // 1. Fetch Projects assigned to JE
  const { data: projectsRes } = useQuery({
    queryKey: ['dashboardProjects'],
    queryFn: async () => {
      const res = await authApi.get('/projects');
      return res.data;
    },
    staleTime: 30000
  });

  const projects = projectsRes?.projects ?? EMPTY_ARRAY;

  // 2. Fetch Estimates
  const { data: estimatesRes } = useQuery({
    queryKey: ['estimates', { limit: 100 }],
    queryFn: async () => {
      const res = await authApi.get('/estimates?limit=100');
      return res.data;
    },
    staleTime: 60000
  });

  const estimates = estimatesRes?.estimates ?? EMPTY_ARRAY;

  // 3. Fetch Requisitions
  const { data: requisitionsRes } = useQuery({
    queryKey: ['jeDashboardRequisitions'],
    queryFn: async () => {
      const res = await authApi.get('/requisitions');
      return res.data;
    },
    staleTime: 60000
  });

  const requisitions = requisitionsRes?.requisitions ?? EMPTY_ARRAY;

  // 4. Fetch JE's Daily Progress Reports
  const { data: dprRes } = useQuery({
    queryKey: ['jeDprReports'],
    queryFn: async () => {
      const res = await getProgressReports({ limit: 50 });
      return res.data;
    },
    staleTime: 30000
  });

  const dprReports = dprRes?.reports ?? EMPTY_ARRAY;

  // 5. Fetch User Mappings for assigned ZO Office details
  const { data: mappingsRes } = useQuery({
    queryKey: ['jeZoUserMappings'],
    queryFn: async () => {
      const res = await getUserMappings();
      return res.data;
    },
    staleTime: 60000
  });

  const activeZoMapping = useMemo(() => {
    const list = mappingsRes?.mappings || (Array.isArray(mappingsRes) ? mappingsRes : []);
    if (list.length > 0) {
      const mob = (user?.mobile_number || '').replace(/\D/g, '');
      const match = list.find(m => {
        const jMob = (m.je_user_id || '').replace(/\D/g, '');
        return (jMob && mob && jMob === mob) || m.je_user_id === user?.mobile_number;
      });
      if (match) return match;
      return list.find(m => m.is_active !== false) || list[0];
    }

    // Fallback from assigned project ZO metadata
    const projWithZo = projects.find(p => p.zo_name || p.zo_user_id || p.zone);
    if (projWithZo) {
      return {
        zo_name: projWithZo.zo_name || projWithZo.zone || 'Zonal Office',
        zo_user_id: projWithZo.zo_user_id || 'N/A'
      };
    }

    return null;
  }, [mappingsRes, user, projects]);

  // Map everything to a unified projects list for the JE
  const mappedProjects = useMemo(() => {
    return projects.map(p => {
      const matchingEst = estimates.find(e => e.work_order_no === p.work_order_no);
      const reqCount = requisitions.filter(r => r.work_order_no === p.work_order_no).length;

      // Find latest DPR for this work order
      const projectDprs = dprReports.filter(d => d.work_order_no === p.work_order_no);
      const latestDpr = projectDprs.length > 0
        ? projectDprs.reduce((max, curr) => (Number(curr.physical_work_progress || 0) > Number(max.physical_work_progress || 0) ? curr : max), projectDprs[0])
        : null;

      const physicalProg = latestDpr ? Number(latestDpr.physical_work_progress || 0) : Number(p.physical_progress || 0);

      const lastLoggedText = latestDpr?.site_visit_date 
        ? `logged ${new Date(latestDpr.site_visit_date).toLocaleDateString('en-IN')}` 
        : 'no logs yet';

      return {
        wo: p.work_order_no,
        location: p.site_details || 'Site Location',
        progress: physicalProg,
        estimates: matchingEst?.estimate_status || 'Under ZO Review',
        requisitions: reqCount,
        lastLogged: lastLoggedText
      };
    });
  }, [projects, estimates, requisitions, dprReports]);

  // Derive stats
  const totalDprs = dprReports.length;
  const approvedEstsCount = estimates.filter(e => (e.estimate_status || '').toLowerCase().includes('approved')).length;
  const pendingEstsCount = estimates.filter(e => !(e.estimate_status || '').toLowerCase().includes('approved')).length;

  const streakCount = useMemo(() => {
    if (user?.daily_streak && Number(user.daily_streak) > 0) return Number(user.daily_streak);
    const dates = Array.from(new Set(dprReports.map(r => r.site_visit_date).filter(Boolean))).sort().reverse();
    return dates.length > 0 ? dates.length : 0;
  }, [user, dprReports]);

  return (
    <div className="space-y-8 pb-12">
      {/* Top Streak Header Strip */}
      <div className="glass-panel p-6 rounded-3xl relative overflow-hidden flex flex-col md:flex-row items-center justify-between gap-6 border border-white/5">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-2xl select-none">
            🔥
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-amber-500">Continuous Site Logging Streak</span>
            <h3 className="text-xl font-extrabold text-slate-100 mt-0.5">{streakCount} Days Reporting Active</h3>
          </div>
        </div>
        <div className="flex gap-8 text-center md:text-right">
          <div>
            <span className="text-[9px] uppercase tracking-wider text-slate-400 block font-bold">Assigned Projects</span>
            <span className="text-sm font-extrabold text-slate-200">{projects.length || 0} Sites Mapped</span>
          </div>
          <div>
            <span className="text-[9px] uppercase tracking-wider text-slate-400 block font-bold">Operator Role</span>
            <span className="text-sm font-extrabold text-amber-500 uppercase">Junior Engineer</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column (2/3) */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* Assigned Mapped Work Orders */}
          <div className="glass-panel p-6 rounded-3xl border border-white/5">
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-6">Assigned Mapped Work Orders</h2>
            {mappedProjects.length === 0 ? (
              <div className="text-slate-500 text-xs py-8 text-center uppercase tracking-widest">No assigned projects mapped to your ID</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/5 pb-3">
                      <th className="text-[10px] font-bold uppercase tracking-wider text-slate-400 py-3">Work Order No</th>
                      <th className="text-[10px] font-bold uppercase tracking-wider text-slate-400 py-3">Site Location</th>
                      <th className="text-[10px] font-bold uppercase tracking-wider text-slate-400 py-3 text-center">Estimate Status</th>
                      <th className="text-[10px] font-bold uppercase tracking-wider text-slate-400 py-3 text-right">Site Progress</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {mappedProjects.map((row, idx) => (
                      <tr key={idx} className="hover:bg-white/5 transition-colors">
                        <td className="py-3.5 text-xs font-bold text-sky-400 font-mono">{row.wo}</td>
                        <td className="py-3.5 text-xs font-semibold text-slate-200">{row.location}</td>
                        <td className="py-3.5 text-center">
                          <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider bg-sky-500/10 text-sky-400 border border-sky-500/20">
                            {row.estimates}
                          </span>
                        </td>
                        <td className="py-3.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-xs font-bold text-slate-100">{row.progress}%</span>
                            <div className="w-16 h-1.5 rounded-full bg-white/10 overflow-hidden">
                              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${row.progress}%` }} />
                            </div>
                          </div>
                          <div className="text-[9px] text-slate-500 text-right mt-0.5">{row.lastLogged}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Your Reports */}
          <div className="glass-panel p-6 rounded-3xl border border-white/5">
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-6">Your Performance Reports</h2>
            
            {/* Stats Trio */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-white/5 border border-white/5 rounded-2xl p-4">
                <span className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Total Reports</span>
                <span className="text-2xl font-bold text-slate-100 font-mono">{totalDprs}</span>
              </div>
              <div className="bg-white/5 border border-white/5 rounded-2xl p-4">
                <span className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Approved Estimates</span>
                <span className="text-2xl font-bold text-emerald-400 font-mono">{approvedEstsCount}</span>
              </div>
              <div className="bg-white/5 border border-white/5 rounded-2xl p-4">
                <span className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Pending Review</span>
                <span className="text-2xl font-bold text-amber-500 font-mono">{pendingEstsCount}</span>
              </div>
            </div>

            {/* Daily Progress Submissions Table */}
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-4 border-b border-white/5 pb-2">
              Recent Daily Progress Submissions
            </h3>
            {dprReports.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="text-[10px] text-slate-500 uppercase tracking-wider border-b border-white/5">
                      <th className="pb-2 py-2">Site Visit Date</th>
                      <th className="pb-2 py-2">Work Order No</th>
                      <th className="pb-2 py-2 text-center">Progress</th>
                      <th className="pb-2 py-2 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-slate-300">
                    {dprReports.slice(0, 5).map((report) => (
                      <tr key={report.report_id}>
                        <td className="py-2.5 font-bold text-slate-100">
                          {new Date(report.site_visit_date).toLocaleDateString('en-IN', { timeZone: 'UTC' })}
                        </td>
                        <td className="py-2.5 font-mono text-sky-400">{report.work_order_no}</td>
                        <td className="py-2.5 text-center font-semibold text-amber-400">{report.physical_work_progress}%</td>
                        <td className="py-2.5 text-right">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[8px] font-bold uppercase ${
                            report.approval_status === 'Approved' 
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                              : report.approval_status === 'Rejected'
                              ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                              : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          }`}>
                            {report.approval_status || 'Approved'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-slate-500 text-xs py-8 text-center font-bold uppercase tracking-widest">
                No recent daily progress submissions
              </div>
            )}
          </div>

        </div>

        {/* Right Column (1/3) */}
        <div className="space-y-8">
          
          {/* Quick Action Panel */}
          <div className="glass-panel p-6 rounded-3xl border border-white/5">
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-6">Quick Action Panel</h2>
            <div className="grid grid-cols-1 gap-3">
              <Link to="/daily-progress" className="flex items-center justify-between p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 transition">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider">Log Site Progress</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Upload daily logs &amp; site photos</div>
                </div>
                <span className="text-sm font-black">&rarr;</span>
              </Link>
              <Link to="/estimates" className="flex items-center justify-between p-3.5 rounded-2xl bg-white/5 border border-white/5 hover:border-amber-500/30 text-slate-300 hover:text-amber-400 transition">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider">Create Cost Estimate</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Draft materials &amp; measurements</div>
                </div>
                <span className="text-sm font-black">&rarr;</span>
              </Link>
              <Link to="/requisitions" className="flex items-center justify-between p-3.5 rounded-2xl bg-white/5 border border-white/5 hover:border-amber-500/30 text-slate-300 hover:text-amber-400 transition">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider">Submit Requisition</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Declare GST &amp; vendor bill</div>
                </div>
                <span className="text-sm font-black">&rarr;</span>
              </Link>
            </div>
          </div>

          {/* Assigned Zonal Office Mapping Card */}
          <div className="glass-panel p-6 rounded-3xl border border-white/5">
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-4 border-b border-white/5 pb-2">
              Assigned Zonal Office
            </h2>
            {activeZoMapping ? (
              <div className="space-y-3">
                <div>
                  <div className="text-[10px] text-slate-500 font-bold uppercase">Officer Name</div>
                  <div className="text-sm font-bold text-slate-100">{activeZoMapping.zo_name}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 font-bold uppercase">Contact Number</div>
                  <div className="text-sm font-semibold text-slate-300 font-mono">{activeZoMapping.zo_user_id}</div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <div className="text-[10px] text-slate-500 font-bold uppercase">Assigned Office</div>
                  <div className="text-sm font-bold text-slate-100">Unassigned Zonal Office</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 font-bold uppercase">Contact Number</div>
                  <div className="text-sm font-semibold text-slate-300 font-mono">N/A</div>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
};

export default JeDashboardView;
