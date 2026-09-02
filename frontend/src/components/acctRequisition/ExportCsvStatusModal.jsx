import { useState } from 'react';
import { Modal, Button } from '../ui';

const STATUS_OPTIONS = [
  'Pending HO Review',
  'Approved',
  'Partially Approved',
  'Credit Approved',
  'On Hold',
  'Returned for Correction',
  'Rejected',
  'Pending Review'
];

/**
 * Lets the user narrow a sheet's "Export to CSV" to one status (or every
 * item) before the file is built, instead of always dumping the whole
 * sheet. Purely a client-side filter over the already-loaded `items` array
 * — buildSheetCsv (acctSheetCsv.js) itself takes no status param, so the
 * caller filters before calling it.
 */
const ExportCsvStatusModal = ({ isOpen, onClose, onExport }) => {
  const [status, setStatus] = useState('All');

  const handleExport = () => {
    onExport(status);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md" subtitle="Export" title="Export to CSV">
      <p className="text-xs text-slate-400 mb-4">Choose which line items to include in the export.</p>

      <div className="flex flex-col gap-1.5 mb-6">
        {['All', ...STATUS_OPTIONS].map((s) => {
          const isActive = status === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-200 flex items-center justify-between select-none ${
                isActive
                  ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20 font-extrabold ring-1 ring-amber-400'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-white/5'
              }`}
            >
              <span>{s === 'All' ? 'All Statuses' : s}</span>
              {isActive && <span className="w-1.5 h-1.5 rounded-full bg-slate-950"></span>}
            </button>
          );
        })}
      </div>

      <Button variant="amber" onClick={handleExport} className="w-full">
        Export
      </Button>
    </Modal>
  );
};

export default ExportCsvStatusModal;
