import React, { useEffect } from 'react';
import { Modal, Button } from './index';

export const SuccessPopup = ({
  isOpen = false,
  title = 'Estimate Saved',
  description = 'Your changes are live in reports and analytics right away — no approval needed.',
  onClose
}) => {
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        if (onClose) onClose();
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="sm"
      className="text-center border-emerald-500/30"
    >
      <div className="flex flex-col items-center justify-center pt-4 pb-2 px-2">
        <div className="mx-auto w-16 h-16 rounded-full bg-gradient-to-tr from-emerald-500 to-teal-500 p-0.5 shadow-lg shadow-emerald-500/20 flex items-center justify-center mb-4 animate-bounce">
          <div className="w-full h-full rounded-full bg-slate-900 flex items-center justify-center">
            <svg className="w-8 h-8 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>
        <h3 className="text-lg font-extrabold text-slate-100 uppercase tracking-wider mb-2">
          {title}
        </h3>
        <p className="text-xs text-slate-400 mb-6 leading-relaxed text-center">
          {description}
        </p>
        <Button
          variant="primary"
          onClick={onClose}
          className="w-full justify-center"
        >
          Done
        </Button>
      </div>
    </Modal>
  );
};

export default SuccessPopup;
