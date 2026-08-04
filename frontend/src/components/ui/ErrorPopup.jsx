import React, { useEffect } from 'react';
import { Modal, Button } from './index';

export const ErrorPopup = ({
  isOpen = false,
  title = 'Operation Failed',
  description = 'An error occurred while performing the action.',
  onClose
}) => {
  // Let errors stay on screen slightly longer (5 seconds) by default
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        if (onClose) onClose();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="sm"
      className="text-center border-rose-500/30"
    >
      <div className="flex flex-col items-center justify-center pt-4 pb-2 px-2">
        {/* Animated Warning Icon with Red Glow */}
        <div className="mx-auto w-16 h-16 rounded-full bg-gradient-to-tr from-rose-500 to-red-500 p-0.5 shadow-lg shadow-rose-500/20 flex items-center justify-center mb-4 animate-pulse">
          <div className="w-full h-full rounded-full bg-slate-900 flex items-center justify-center">
            <svg className="w-8 h-8 text-rose-500" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
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
          variant="secondary"
          onClick={onClose}
          className="w-full justify-center border-rose-500/30 text-rose-400 hover:bg-rose-500/10 focus:ring-rose-500/20"
        >
          Dismiss
        </Button>
      </div>
    </Modal>
  );
};

export default ErrorPopup;
