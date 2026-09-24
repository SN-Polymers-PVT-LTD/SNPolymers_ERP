import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui';
import EmployeeMaster from './EmployeeMaster';
import PermanentPayStructure from './PermanentPayStructure';

export default function EmployeeManagement() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get('tab');
  const activeTab = urlTab === 'pay-structure' ? 'pay-structure' : 'directory';
  const selectedEmployeeId = searchParams.get('employeeId') || '';

  const handleTabChange = (tab, employeeId = '') => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (tab === 'pay-structure') {
        next.set('tab', 'pay-structure');
        if (employeeId) {
          next.set('employeeId', employeeId);
        }
      } else {
        next.delete('tab');
        next.delete('employeeId');
      }
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {/* Module Title & Tab Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
              Admin Module
            </span>
            <span className="text-xs text-slate-500">/</span>
            <span className="text-xs text-slate-400 font-semibold">Employee Management</span>
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight mt-1">
            Employee Management
          </h1>
        </div>

        {/* Tab Buttons */}
        <div className="flex items-center gap-2 p-1.5 rounded-xl bg-slate-950/60 border border-white/10 self-start sm:self-auto">
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
        </div>
      </div>

      {/* Render Active View */}
      {activeTab === 'directory' ? (
        <EmployeeMaster
          onNavigateToPayStructure={(empId) => handleTabChange('pay-structure', empId)}
        />
      ) : (
        <PermanentPayStructure initialEmployeeId={selectedEmployeeId} />
      )}
    </div>
  );
}
