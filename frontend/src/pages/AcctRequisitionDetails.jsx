import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui';
import RequisitionDetailsPanel from '../components/acctRequisition/RequisitionDetailsPanel';

/**
 * Standalone page for the "Requisition Details" flattened line-item search —
 * split out of both AcctRequisitions.jsx's (Accounts) and AcctHoQueue.jsx's
 * (HO) in-page tab toggle so it has its own URL instead of only being
 * reachable via local component state. Mounted at two routes —
 * /acct-requisitions/details (Accounts) and /acct-requisitions/ho-queue/details
 * (HO) — this single component tells them apart via the current path so
 * both sides get the same page/back-button/basePath behavior their old
 * in-page tab had. Not linked from the sidebar; reached via the
 * "Requisition Details" button on each side's Sheets page.
 */
const AcctRequisitionDetails = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isHo = pathname.startsWith('/acct-requisitions/ho-queue');

  const backTo = isHo ? '/acct-requisitions/ho-queue' : '/acct-requisitions';
  const backLabel = isHo ? '← Back to Queue' : '← Back to Sheets';
  const eyebrow = isHo ? 'HO · Accounts Requisition Review' : 'Accounts Department · HO Approval';
  const sheetDetailBasePath = isHo ? '/acct-requisitions/ho-queue/sheets' : '/acct-requisitions/sheets';

  return (
    <>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-8 pb-6 border-b border-white/5 shrink-0">
        <div>
          <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">
            {eyebrow}
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Requisition Details</h1>
          <p className="text-xs text-slate-400 font-medium mt-1.5">
            Search and export line items across every requisition sheet, filtered by sub-title,
            beneficiary, debit bank, status, or date range.
          </p>
        </div>
        <Button variant="glass" size="sm" onClick={() => navigate(backTo)}>
          {backLabel}
        </Button>
      </div>

      <RequisitionDetailsPanel sheetDetailBasePath={sheetDetailBasePath} />
    </>
  );
};

export default AcctRequisitionDetails;
