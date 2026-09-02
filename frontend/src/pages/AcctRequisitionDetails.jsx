import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui';
import RequisitionDetailsPanel from '../components/acctRequisition/RequisitionDetailsPanel';

/**
 * Standalone page for the "Requisition Details" flattened line-item search —
 * split out of AcctRequisitions.jsx's in-page tab toggle so it has its own
 * URL (/acct-requisitions/details) instead of only being reachable via local
 * component state. Not linked from the sidebar; reached via the "Requisition
 * Details" button on the Sheets page.
 */
const AcctRequisitionDetails = () => {
  const navigate = useNavigate();

  return (
    <>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-8 pb-6 border-b border-white/5 shrink-0">
        <div>
          <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">
            Accounts Department · HO Approval
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Requisition Details</h1>
          <p className="text-xs text-slate-400 font-medium mt-1.5">
            Search and export line items across every requisition sheet, filtered by sub-title,
            beneficiary, debit bank, status, or date range.
          </p>
        </div>
        <Button variant="glass" size="sm" onClick={() => navigate('/acct-requisitions')}>
          ← Back to Sheets
        </Button>
      </div>

      <RequisitionDetailsPanel sheetDetailBasePath="/acct-requisitions/sheets" />
    </>
  );
};

export default AcctRequisitionDetails;
