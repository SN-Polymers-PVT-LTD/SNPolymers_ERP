import { useState, useEffect } from 'react';
import { getQuotations, toggleQuotationFlag } from '../../api/estimatesApi';
import { canFlagQuotation } from '../../utils/estimateQuotationPermissions';
import { useAuth } from '../AuthContext';

export default function QuotationList({ estimateId, estimate }) {
  const { user } = useAuth();
  const [quotations, setQuotations] = useState([]);
  const [updatingId, setUpdatingId] = useState(null);
  const [error, setError] = useState('');

  const loadQuotations = async () => {
    setError('');
    try {
      const res = await getQuotations(estimateId);
      if (res.data?.success) {
        setQuotations(res.data.quotations || []);
      }
    } catch (err) {
      console.error('Failed to load quotations', err);
      setError('Failed to load quotations from server.');
    }
  };

  useEffect(() => {
    if (estimateId) loadQuotations();
  }, [estimateId]);

  const handleFlagToggle = async (quotationId, currentFlag) => {
    setUpdatingId(quotationId);
    try {
      await toggleQuotationFlag(estimateId, quotationId, !currentFlag);
      await loadQuotations();
    } catch (err) {
      console.error('Failed to toggle flag', err);
    } finally {
      setUpdatingId(null);
    }
  };

  if (quotations.length === 0 && !error) return null;

  const allowedToFlag = canFlagQuotation(estimate, user);

  return (
    <div className="glass-panel p-6 rounded-3xl border border-white/5 space-y-6 mt-8">
      <h3 className="text-xs uppercase font-extrabold tracking-widest text-slate-200">
        Dealer Quotations
      </h3>

      {error && <p className="text-xs text-rose-500 font-semibold">{error}</p>}

      <div className="space-y-3">
        {quotations.map((q) => {
          const isFlagDisabled = updatingId === q.quotation_id || !allowedToFlag;
          return (
            <div
              key={q.quotation_id}
              className={`flex justify-between items-center p-3.5 bg-white/[0.01] border rounded-2xl text-xs transition duration-200 ${
                q.is_deleted
                  ? 'border-white/5 opacity-55 line-through'
                  : q.flagged_for_replacement
                  ? 'border-rose-500/40 bg-rose-950/[0.01]'
                  : 'border-white/5'
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  {q.is_deleted ? (
                    <span className="font-semibold text-slate-500">{q.original_filename}</span>
                  ) : (
                    <a
                      href={q.quotation_signed_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-bold text-slate-200 hover:text-amber-500 underline truncate max-w-[250px]"
                    >
                      {q.original_filename}
                    </a>
                  )}
                  {q.is_deleted && (
                    <span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-red-500/20 text-red-400">
                      Deleted
                    </span>
                  )}
                  {q.is_locked && (
                    <span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-slate-500/20 text-slate-400">
                      Locked
                    </span>
                  )}
                  {q.flagged_for_replacement && !q.is_deleted && (
                    <span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-rose-500/20 text-rose-400">
                      Needs Replacement
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-slate-500 font-medium">
                  {q.vendor_label && <span className="mr-3">Vendor: {q.vendor_label}</span>}
                  <span>Size: {(q.file_size / 1024).toFixed(1)} KB</span>
                </div>
              </div>

              {!q.is_deleted && allowedToFlag && (
                <button
                  onClick={() => handleFlagToggle(q.quotation_id, q.flagged_for_replacement)}
                  disabled={isFlagDisabled}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition duration-200 ${
                    q.flagged_for_replacement
                      ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30 hover:bg-rose-500/30'
                      : 'bg-white/5 text-slate-400 border border-white/10 hover:border-white/20 hover:text-slate-200'
                  }`}
                >
                  {q.flagged_for_replacement ? 'Clear Flag' : 'Flag for Replacement'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
