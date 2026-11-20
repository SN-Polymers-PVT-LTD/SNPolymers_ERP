import React, { useState } from 'react';
import { useSearchParams, Navigate, Link } from 'react-router-dom';
import { Button } from '../../components/ui';
import EmployeeMaster from './EmployeeMaster';
import PermanentPayStructure from './PermanentPayStructure';
import EmployeeStatutorySetup from '../../components/payroll/EmployeeStatutorySetup';
import {useAuth} from '../../components/AuthContext';
import { getEmployees } from '../../api/hrEmployeesApi';
import { getAllPayStructures } from '../../api/hrPayStructuresApi';
import { exportAllEmployeeSheetsToExcel } from '../../utils/exportHelpers';

export default function EmployeeManagement({ payrollSetup = false }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get('tab');
  const {user}=useAuth();
  const isAdmin=user?.role==='admin',allowed=['admin','accounts'].includes(user?.role);
  const activeTab = payrollSetup ? 'payroll-setup' : urlTab === 'pay-structure' ? urlTab : 'directory';
  const selectedEmployeeId = searchParams.get('employeeId') || '';
  const [isExportingWorkbook, setIsExportingWorkbook] = useState(false);

  const handleTabChange = (tab, employeeId = '') => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (tab === 'pay-structure') {
        next.set('tab', tab);
        if (employeeId) next.set('employeeId', employeeId); else next.delete('employeeId');
      } else {
        next.delete('tab');
        next.delete('employeeId');
      }
      return next;
    });
  };

  const handleExportWorkbook = async () => {
    try {
      setIsExportingWorkbook(true);
      const empRes = await getEmployees({ page: 1, limit: 1000 });
      const allEmps = [...(empRes.data?.employees || [])];
      const totalPages = empRes.data?.pagination?.totalPages || 1;
      for (let p = 2; p <= totalPages; p++) {
        const next = await getEmployees({ page: p, limit: 1000 });
        allEmps.push(...(next.data?.employees || []));
      }

      const payRes = await getAllPayStructures();
      const allPay = payRes.data?.pay_structures || [];

      await exportAllEmployeeSheetsToExcel(allEmps, allPay);
    } catch (err) {
      console.error('Failed to export employee workbook:', err);
      alert(err.message || 'Failed to export employee workbook.');
    } finally {
      setIsExportingWorkbook(false);
    }
  };

  if(!allowed)return <p role="alert">Accounts or Admin employee management access is required.</p>;
  if (!payrollSetup && (!isAdmin || urlTab === 'payroll-setup')) {
    const params = new URLSearchParams(searchParams);
    params.delete('tab');
    if (selectedEmployeeId && !params.has('employee')) params.set('employee', selectedEmployeeId);
    params.delete('employeeId');
    return <Navigate to={{ pathname: '/acct-requisitions/payroll-setup', search: params.toString() }} replace />;
  }
  return (
    <div className="space-y-6">
      {/* Module Title & Tab Navigation */}
      {activeTab === 'payroll-setup' ? (
        <header className="space-y-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                Accounts
              </span>
              <span className="text-xs text-slate-500">/</span>
              <span className="text-xs text-slate-400 font-semibold">Payroll Management</span>
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight mt-1">
              Employee Payroll Setup
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              {isAdmin ? 'Review statutory coverage and employee deduction history.' : 'Assign company deduction setups and maintain dated statutory coverage.'}
            </p>
          </div>

          {/* Tab Navigation */}
          {!isAdmin && <nav className="flex space-x-6 border-b border-white/10" aria-label="Tabs">
            <span className="pb-3 text-xs font-extrabold uppercase tracking-wider border-b-2 border-amber-500 text-slate-100" aria-current="page">
              Employee Payroll Setup
            </span>
            <Link
              to="/admin/payroll/statutory"
              className="pb-3 text-xs font-extrabold uppercase tracking-wider text-slate-400 hover:text-slate-200"
            >
              Statutory Deduction Master
            </Link>
          </nav>}
        </header>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                Employee Management
              </span>
              <span className="text-xs text-slate-500">/</span>
              <span className="text-xs text-slate-400 font-semibold">Employee Management</span>
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight mt-1">
              Employee Management
            </h1>
          </div>

          {/* Tab & Export Buttons */}
          <div className="flex flex-wrap items-center gap-3 self-start sm:self-auto">
            {isAdmin && (
              <Button
                size="sm"
                variant="ghost"
                onClick={handleExportWorkbook}
                disabled={isExportingWorkbook}
                className="flex items-center gap-2 border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 text-xs font-semibold"
                title="Export both Employee Master and Permanent Pay Structure sheets in a single Excel file"
              >
                <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span>{isExportingWorkbook ? 'Exporting...' : 'Export Both Sheets'}</span>
              </Button>
            )}
            <div className="flex items-center gap-2 p-1.5 rounded-xl bg-slate-950/60 border border-white/10">
              {isAdmin && (
                <>
                  <Button
                    size="sm"
                    variant={activeTab === 'directory' ? 'primary' : 'ghost'}
                    onClick={() => handleTabChange('directory')}
                    className="text-xs"
                  >
                    Employee & Worker Master
                  </Button>
                  <Button
                    size="sm"
                    variant={activeTab === 'pay-structure' ? 'primary' : 'ghost'}
                    onClick={() => handleTabChange('pay-structure')}
                    className="text-xs"
                  >
                    Permanent Employee Pay Structure
                  </Button>
                </>
              )}
              <Link to="/acct-requisitions/payroll-setup" className="px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white">
                Employee Payroll Setup
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Render Active View */}
      {activeTab === 'payroll-setup' ? <EmployeeStatutorySetup /> : activeTab === 'directory' ? (
        <EmployeeMaster
          onNavigateToPayStructure={(empId) => handleTabChange('pay-structure', empId)}
        />
      ) : (
        <PermanentPayStructure initialEmployeeId={selectedEmployeeId} onEmployeeChange={id => handleTabChange('pay-structure', id)} />
      )}
    </div>
  );
}
