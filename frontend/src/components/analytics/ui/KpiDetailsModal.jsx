import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../../ThemeContext';
import Modal from '../../ui/Modal';
import { formatINR } from '../utils/formatters';

export const KpiDetailsModal = ({
  title,
  colorClass: _colorClass,
  projects = [],
  onClose,
  getZoDisplayName = null
}) => {
  const navigate = useNavigate();
  const { isDark } = useTheme();

  const handleWoClick = (workOrderNo) => {
    if (onClose) onClose();
    navigate(`/projects/${workOrderNo}/digital-twin`);
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={title}
      subtitle={`${projects.length} ${projects.length === 1 ? 'Project' : 'Projects'}`}
      size="xl"
    >
      <div className="overflow-x-auto">
        {projects.length === 0 ? (
          <div
            className={`text-center py-12 text-xs font-bold uppercase tracking-wider ${
              isDark ? 'text-slate-500' : 'text-slate-400'
            }`}
          >
            No projects matching this filter
          </div>
        ) : (
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr
                className={`border-b text-[9px] font-black uppercase tracking-widest ${
                  isDark ? 'border-white/10 text-slate-400' : 'border-slate-200 text-slate-500'
                }`}
              >
                <th className="py-3 px-3">WO No</th>
                <th className="py-3 px-3">ZO Name</th>
                <th className="py-3 px-3">Department</th>
                <th className="py-3 px-3 text-center">Value</th>
                <th className="py-3 px-3 text-center">Progress</th>
                <th className="py-3 px-3 text-center">Health</th>
                <th className="py-3 px-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDark ? 'divide-white/5' : 'divide-slate-100'}`}>
              {projects.map((p, idx) => {
                const scoreBadge =
                  p.health_score >= 80
                    ? isDark
                      ? 'bg-emerald-950/80 text-emerald-400 border-emerald-500/30'
                      : 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30 font-extrabold'
                    : p.health_score >= 60
                    ? isDark
                      ? 'bg-amber-950/80 text-amber-400 border-amber-500/30'
                      : 'bg-amber-500/10 text-amber-800 border-amber-500/30 font-extrabold'
                    : isDark
                    ? 'bg-rose-950/80 text-rose-400 border-rose-500/30'
                    : 'bg-rose-500/10 text-rose-700 border-rose-500/30 font-extrabold';

                const statusBadge =
                  p.health_status === 'Critical'
                    ? isDark
                      ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                      : 'bg-rose-50 text-rose-700 border-rose-200 font-black'
                    : p.health_status === 'Warning'
                    ? isDark
                      ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                      : 'bg-amber-50 text-amber-800 border-amber-200 font-black'
                    : isDark
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-emerald-50 text-emerald-800 border-emerald-200 font-black';

                const zoDisplayName = getZoDisplayName
                  ? getZoDisplayName(p.zo_name || p.zo_user_id || p.zone)
                  : p.zone || p.zo_name || p.zo_user_id || 'N/A';

                return (
                  <tr
                    key={p.work_order_no || idx}
                    className={`transition-colors group ${
                      isDark ? 'hover:bg-white/5' : 'hover:bg-slate-50/80'
                    }`}
                  >
                    <td
                      onClick={() => handleWoClick(p.work_order_no)}
                      className={`py-3.5 px-3 font-extrabold hover:underline cursor-pointer font-mono ${
                        isDark ? 'text-sky-400' : 'text-sky-600'
                      }`}
                    >
                      {p.work_order_no}
                    </td>
                    <td
                      className={`py-3.5 px-3 font-extrabold uppercase ${
                        isDark ? 'text-slate-300' : 'text-slate-700'
                      }`}
                    >
                      {zoDisplayName}
                    </td>
                    <td
                      className={`py-3.5 px-3 font-medium ${
                        isDark ? 'text-slate-400' : 'text-slate-500'
                      }`}
                    >
                      {p.department || 'N/A'}
                    </td>
                    <td
                      className={`py-3.5 px-3 text-center font-mono ${
                        isDark ? 'text-slate-300' : 'text-slate-700'
                      }`}
                    >
                      {formatINR(p.work_order_value)}
                    </td>
                    <td
                      className={`py-3.5 px-3 text-center font-extrabold ${
                        isDark ? 'text-slate-200' : 'text-slate-800'
                      }`}
                    >
                      {p.physical_progress || 0}%
                    </td>
                    <td className="py-3.5 px-3 text-center">
                      <span className={`px-2.5 py-0.5 rounded-lg text-[10px] border ${scoreBadge}`}>
                        {Math.round(p.health_score || 0)}
                      </span>
                    </td>
                    <td className="py-3.5 px-3 text-right">
                      <span
                        className={`px-2.5 py-0.5 rounded-lg text-[8px] uppercase tracking-wider border ${statusBadge}`}
                      >
                        {p.health_status || 'Healthy'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  );
};

export default KpiDetailsModal;
