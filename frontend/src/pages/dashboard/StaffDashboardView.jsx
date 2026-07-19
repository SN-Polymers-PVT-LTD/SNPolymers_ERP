import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import authApi from '../../api/authApi';

const formatINR = (value) => {
  const num = Number(value) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(num);
};

const StaffDashboardView = () => {
  // Fetch payment requisitions
  const { data: requisitionsRes, isLoading } = useQuery({
    queryKey: ['staffDashboardRequisitions'],
    queryFn: async () => {
      const res = await authApi.get('/requisitions');
      return res.data;
    }
  });

  const requisitions = requisitionsRes?.requisitions || [];

  const pendingRequisitions = useMemo(() => {
    return requisitions.filter(r => r.requisition_status === 'Pending');
  }, [requisitions]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 pb-12">
      {/* Left Column (2/3) */}
      <div className="lg:col-span-2 space-y-8">
        <div className="glass-panel p-6 rounded-3xl">
          <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-6">Pending Requisitions Checklist</h2>
          
          {isLoading ? (
            <div className="flex flex-col items-center justify-center p-12 gap-2">
              <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-amber-500" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Loading requisitions...</span>
            </div>
          ) : pendingRequisitions.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-xs uppercase font-extrabold tracking-widest border border-dashed border-white/5 rounded-2xl">
              No pending requisitions to verify.
            </div>
          ) : (
            <div className="space-y-4">
              {pendingRequisitions.map((req, idx) => (
                <div key={idx} className="flex flex-col md:flex-row md:items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/5 hover:border-white/10 transition-all duration-300">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-amber-500 uppercase tracking-widest">{req.requisition_id}</span>
                      <span className="text-[10px] text-slate-400 font-semibold">{req.work_order_no}</span>
                    </div>
                    <h4 className="text-sm font-extrabold text-slate-200">{req.material_main_head || 'Material Supply'}</h4>
                    <span className="text-[9px] text-slate-400 block font-medium">Submitted: {new Date(req.created_at).toLocaleDateString('en-IN')}</span>
                  </div>
                  <div className="mt-4 md:mt-0 flex items-center justify-between md:justify-end gap-6">
                    <div className="text-left md:text-right">
                      <span className="text-[9px] uppercase tracking-wider text-slate-400 block font-bold">Amount Requested</span>
                      <span className="text-xs font-bold text-slate-200">{formatINR(req.approved_amount)}</span>
                    </div>
                    <Link to="/requisitions" className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase bg-amber-500 text-slate-950 hover:bg-amber-400 transition-colors">
                      Review
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right Column (1/3) */}
      <div className="space-y-8">
        <div className="glass-panel p-6 rounded-3xl">
          <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-6">Staff Control</h2>
          <div className="grid grid-cols-1 gap-3">
            <Link to="/requisitions" className="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/5 hover:border-amber-500/30 hover:bg-amber-500/5 text-slate-300 hover:text-amber-400 transition-all duration-300">
              <span className="text-xs font-bold uppercase tracking-wider">Verify Requisitions</span>
              <span className="text-sm font-black">&rarr;</span>
            </Link>
            <Link to="/zonal-balances" className="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/5 hover:border-amber-500/30 hover:bg-amber-500/5 text-slate-300 hover:text-amber-400 transition-all duration-300">
              <span className="text-xs font-bold uppercase tracking-wider">Inspect Zonal Ledgers</span>
              <span className="text-sm font-black">&rarr;</span>
            </Link>
            <Link to="/docs" className="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/5 hover:border-amber-500/30 hover:bg-amber-500/5 text-slate-300 hover:text-amber-400 transition-all duration-300">
              <span className="text-xs font-bold uppercase tracking-wider">Read User Manuals</span>
              <span className="text-sm font-black">&rarr;</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StaffDashboardView;
