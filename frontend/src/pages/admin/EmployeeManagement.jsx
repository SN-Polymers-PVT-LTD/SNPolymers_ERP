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

export default function EmployeeManagement() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get('tab');
  const {user}=useAuth();
  const isAdmin=user?.role==='admin',allowed=['admin','accounts'].includes(user?.role);
  const activeTab = !isAdmin ? 'payroll-setup' : urlTab === 'pay-structure' ? urlTab : 'directory';
  const selectedEmployeeId = searchParams.get('employeeId') || '';
  const [isExportingWorkbook, setIsExportingWorkbook] = useState(false);

  const handleTabChange = (tab, employeeId = '') => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (['pay-structure','payroll-setup'].includes(tab)) {
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
  if(!isAdmin&&urlTab!=='payroll-setup'){const params=new URLSearchParams(searchParams);params.set('tab','payroll-setup');return <Navigate to={{pathname:'/admin/employee-management',search:'?'+params.toString()}} replace/>;}
  if(isAdmin&&urlTab==='payroll-setup')return <p role="alert">Employee payroll setup is maintained by Accounts only.</p>;
  return (
    <div className="space-y-6">
      {/* Module Title & Tab Navigation */}
      {activeTab === 'payroll-setup' ? (
        <header className="space-y-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                Admin
              </span>
              <span className="text-xs text-slate-500">/</span>
              <span className="text-xs text-slate-400 font-semibold">Payroll Management</span>
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight mt-1">
              Employee Payroll Setup
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Assign company deduction setups to employees, manage dated deduction history, and maintain statutory coverage.
            </p>
          </div>

          {/* Tab Navigation */}
          <nav className="flex space-x-6 border-b border-white/10" aria-label="Tabs">
            {user?.role === 'admin' && (
              <Link
                to="/admin/payroll/policies"
                className="pb-3 text-xs font-extrabold uppercase tracking-wider border-b-2 border-transparent text-slate-400 hover:text-slate-200 transition-all duration-200"
              >
                Payroll Policy Master
              </Link>
            )}
            <button
              type="button"
              onClick={() => handleTabChange('payroll-setup')}
              className="pb-3 text-xs font-extrabold uppercase tracking-wider border-b-2 border-amber-500 text-slate-100 transition-all duration-200 cursor-pointer"
            >
              Employee Payroll Setup
            </button>
            <Link
              to="/admin/payroll/statutory"
              className="pb-3 text-xs font-extrabold uppercase tracking-wider border-b-2 border-transparent text-slate-400 hover:text-slate-200 transition-all duration-200"
            >
              Statutory Deduction Master
            </Link>
          </nav>
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
              {!isAdmin && (
                <Button size="sm" variant="primary" onClick={() => handleTabChange('payroll-setup')}>
                  Employee Payroll Setup
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Render Active View */}
      {activeTab === 'payroll-setup' ? <EmployeeStatutorySetup key={selectedEmployeeId} initialEmployeeId={selectedEmployeeId} onEmployeeChange={id=>handleTabChange('payroll-setup',id)}/> : activeTab === 'directory' ? (
        <EmployeeMaster
          onNavigateToPayStructure={(empId) => handleTabChange('pay-structure', empId)}
        />
      ) : (
        <PermanentPayStructure initialEmployeeId={selectedEmployeeId} onEmployeeChange={id => handleTabChange('pay-structure', id)} />
      )}
    </div>
  );
}
