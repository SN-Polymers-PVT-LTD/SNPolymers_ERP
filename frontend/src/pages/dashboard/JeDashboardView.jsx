import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../components/AuthContext';
import authApi from '../../api/authApi';

const JeDashboardView = () => {
  const { user } = useAuth();

  // 1. Fetch Projects (automatically filtered by JE role on backend)
  const { data: projectsRes } = useQuery({
    queryKey: ['dashboardProjects'],
    queryFn: async () => {
      const res = await authApi.get('/projects');
      return res.data;
    },
    staleTime: 60 * 1000
  });

  const projects = projectsRes?.projects || [];

  // 2. Fetch Estimates to get status matching each work order
  const { data: estimatesRes } = useQuery({
    queryKey: ['estimates', { limit: 100 }],
    queryFn: async () => {
      const res = await authApi.get('/estimates?limit=100');
      return res.data;
    },
    staleTime: 60 * 1000
  });

  const estimates = estimatesRes?.estimates || [];

  // 3. Fetch Requisitions to count logs raised per project
  const { data: requisitionsRes } = useQuery({
    queryKey: ['jeDashboardRequisitions'],
    queryFn: async () => {
      const res = await authApi.get('/requisitions');
      return res.data;
    },
    staleTime: 60 * 1000
  });

  const requisitions = requisitionsRes?.requisitions || [];

  // Map everything to a unified projects list for the JE
  const mappedProjects = useMemo(() => {
    return projects.map(p => {
      // Find matching cost estimate
      const matchingEst = estimates.find(e => e.work_order_no === p.work_order_no);
      // Count requisitions raised
      const reqCount = requisitions.filter(r => r.work_order_no === p.work_order_no).length;

      return {
        wo: p.work_order_no,
        location: p.site_details || 'Site Location',
        progress: p.status === 'Closed' ? 100 : p.status === 'Complete Under Maintenance' ? 100 : 45, // default approximation if no daily logs exist
        estimates: matchingEst?.estimate_status || 'Not Initialized',
        requisitions: reqCount
      };
    });
  }, [projects, estimates, requisitions]);

  const streakCount = user?.daily_streak || 0;

  return (
    <div className="space-y-8 pb-12">
      {/* Top Streak indicator */}
      <div className="glass-panel p-6 rounded-3xl relative overflow-hidden flex flex-col md:flex-row items-center justify-between gap-6 shadow-[0_8px_32px_rgba(245,158,11,0.03)]">
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
            <span className="text-sm font-extrabold text-slate-200">{projects.length} Sites Mapped</span>
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
          {/* Mapped projects */}
          <div className="glass-panel p-6 rounded-3xl">
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
                      <th className="text-[10px] font-bold uppercase tracking-wider text-slate-400 py-3 text-center">Bills Raised</th>
                      <th className="text-[10px] font-bold uppercase tracking-wider text-slate-400 py-3 text-right">Site Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {mappedProjects.map((row, idx) => (
                      <tr key={idx} className="hover:bg-white/5 transition-colors">
                        <td className="py-4 text-xs font-extrabold text-amber-500">{row.wo}</td>
                        <td className="py-4 text-xs font-bold text-slate-200">{row.location}</td>
                        <td className="py-4 text-center">
                          <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider ${
                            row.estimates === 'Final Approved' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                            row.estimates === 'Under ZO Review' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                            'bg-slate-500/10 text-slate-400 border border-white/5'
                          }`}>
                            {row.estimates}
                          </span>
                        </td>
                        <td className="py-4 text-xs font-bold text-slate-400 text-center">{row.requisitions} items</td>
                        <td className="py-4">
                          <div className="flex items-center justify-end gap-3">
                            <span className="text-xs font-bold text-slate-200">{row.progress}%</span>
                            <div className="w-16 h-1.5 rounded-full bg-white/5 overflow-hidden">
                              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${row.progress}%` }} />
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right Column (1/3) */}
        <div className="space-y-8">
          {/* JE Quick actions */}
          <div className="glass-panel p-6 rounded-3xl">
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-6">Quick Action Panel</h2>
            <div className="grid grid-cols-1 gap-3">
              <Link to="/daily-progress" className="flex items-center justify-between p-4 rounded-2xl bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-500/30 hover:border-amber-500/50 text-slate-100 hover:shadow-lg transition-all duration-300">
                <div className="text-left">
                  <span className="text-xs font-bold uppercase tracking-wider block">Log Site Progress</span>
                  <span className="text-[10px] text-slate-400 mt-1 block">Upload daily site logs & photos</span>
                </div>
                <span className="text-lg font-black">&rarr;</span>
              </Link>
              
              <Link to="/estimates" className="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/5 hover:border-white/10 text-slate-200 transition-all duration-300">
                <div className="text-left">
                  <span className="text-xs font-bold uppercase tracking-wider block">Create Cost Estimate</span>
                  <span className="text-[10px] text-slate-400 mt-1 block">Draft materials & measurements</span>
                </div>
                <span className="text-lg font-black">&rarr;</span>
              </Link>

              <Link to="/requisitions" className="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/5 hover:border-white/10 text-slate-200 transition-all duration-300">
                <div className="text-left">
                  <span className="text-xs font-bold uppercase tracking-wider block">Submit Requisition</span>
                  <span className="text-[10px] text-slate-400 mt-1 block">Declare GST & submit vendor bill</span>
                </div>
                <span className="text-lg font-black">&rarr;</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default JeDashboardView;
