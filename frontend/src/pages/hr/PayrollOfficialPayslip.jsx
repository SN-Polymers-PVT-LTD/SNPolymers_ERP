import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../components/AuthContext';
import { Button } from '../../components/ui';
import { getOfficialPayslip } from '../../api/payrollReportsApi';
import PayrollPayslip from '../../components/payroll/PayrollPayslip';

export default function PayrollOfficialPayslip() {
  const { rowId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const query = useQuery({
    queryKey: ['official-payroll-payslip', user.id, rowId],
    queryFn: async () => (await getOfficialPayslip(rowId)).data.payslip,
  });

  if (query.isPending) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        <div className="glass-panel bg-slate-900/80 rounded-3xl p-8 sm:p-12 text-center space-y-4 border border-white/10">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 mx-auto flex items-center justify-center animate-pulse">
            <svg className="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
          <p role="status" className="text-sm font-semibold text-slate-300">
            Loading Locked payslip…
          </p>
        </div>
      </div>
    );
  }

  if (query.isError) {
    const errorMessage = query.error?.response?.data?.message || query.error.message;
    return (
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        <div
          role="alert"
          className="glass-panel bg-rose-500/10 border border-rose-500/20 rounded-3xl p-6 sm:p-8 space-y-4 text-rose-300"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">Payslip Access Error</h3>
              <p className="text-xs text-rose-300/90 mt-0.5">{errorMessage}</p>
            </div>
          </div>
          <div className="pt-2 flex items-center gap-3">
            <Button variant="danger" size="sm" onClick={() => query.refetch()}>
              Retry payslip
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
              Go Back
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      <style>{`
        @media print {
          .payroll-report-controls {
            display: none !important;
          }
          body {
            background: white !important;
            color: black !important;
          }
          .glass-panel {
            background: white !important;
            box-shadow: none !important;
            border: 1px solid #cbd5e1 !important;
          }
        }
      `}</style>

      {/* Action Toolbar & Navigation Header */}
      <div className="payroll-report-controls flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl glass-panel bg-slate-900/60 border border-white/10 shadow-lg">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(-1)}
            className="text-slate-300 hover:text-white"
            icon={
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            }
          >
            Back
          </Button>
          <div className="h-4 w-px bg-white/10" />
          <nav className="text-xs text-slate-400 flex items-center gap-1.5 font-medium">
            <span>HR</span>
            <span>/</span>
            <span>Payroll</span>
            <span>/</span>
            <span className="text-slate-200 font-semibold">Official Payslip</span>
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            size="sm"
            onClick={() => window.print()}
            className="shadow-lg shadow-indigo-500/20 hover:scale-[1.02] active:scale-[0.98]"
            icon={
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
            }
          >
            Print official payslip
          </Button>
        </div>
      </div>

      {/* Official Payslip Voucher */}
      <PayrollPayslip payslip={query.data} />
    </div>
  );
}
