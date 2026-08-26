import React from 'react';
import { Modal, Button } from './index';

/**
 * A richer success confirmation than SuccessPopup — reserved for
 * sheet/record-state-changing actions (submit, finalize) rather than every
 * minor save. Generalized from the inline "Premium Success Modal" pattern
 * in EstimateView.jsx (Approve All / Submit Final Review), with the
 * estimate-specific fields lifted into a generic `details` list.
 */
const PremiumSuccessModal = ({
  isOpen = false,
  onClose,
  eyebrow = 'Transaction Confirmed',
  title,
  message,
  details = [], // [{ label, value, pill?: boolean }]
  ctaLabel = 'Continue'
}) => {
  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title=""
      subtitle=""
      size="sm"
      footer={
        <Button
          variant="amber"
          onClick={onClose}
          className="w-full py-3 text-xs uppercase tracking-wider font-extrabold"
        >
          {ctaLabel}
        </Button>
      }
    >
      <div className="text-center py-6 space-y-5 animate-fadeIn">
        <div className="mx-auto w-16 h-16 rounded-full bg-gradient-to-tr from-emerald-500 to-teal-500 p-0.5 shadow-lg shadow-emerald-500/20 flex items-center justify-center animate-bounce">
          <div className="w-full h-full rounded-full bg-black flex items-center justify-center">
            <svg className="w-8 h-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>

        <div className="space-y-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-amber-500 font-bold">{eyebrow}</span>
          <h3 className="text-xl font-extrabold text-white tracking-tight">{title}</h3>
          {message && <p className="text-xs text-slate-400 leading-relaxed px-2">{message}</p>}
        </div>

        {details.length > 0 && (
          <div className="glass-panel p-4 rounded-2xl border border-white/5 bg-white/[0.01] text-left space-y-2">
            {details.map((d, i) => (
              <React.Fragment key={d.label}>
                {i > 0 && <div className="h-px bg-white/5" />}
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500 font-medium">{d.label}:</span>
                  {d.pill ? (
                    <span className="font-bold text-emerald-400 uppercase tracking-wide bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded text-[10px]">
                      {d.value}
                    </span>
                  ) : (
                    <span className="font-mono font-bold text-slate-200">{d.value}</span>
                  )}
                </div>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
};

export default PremiumSuccessModal;
