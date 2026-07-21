import React, { useEffect, useRef } from 'react';
import { useModalOverlay } from '../ModalContext';

const Modal = ({
  isOpen = true,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md', // 'sm' | 'md' | 'lg' | 'xl' | '2xl'
  closeOnOverlayClick = true,
  className = '',
  ...props
}) => {
  const overlayRef = useRef(null);
  const { openModal, closeModal } = useModalOverlay();

  // Signal global modal state so dock hides
  useEffect(() => {
    if (isOpen) {
      openModal();
      return () => closeModal();
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lock body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Escape key to close
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && onClose) {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    '2xl': 'max-w-6xl',
  };

  const maxWidthClass = sizeClasses[size] || sizeClasses.md;

  const handleOverlayClick = (e) => {
    if (closeOnOverlayClick && overlayRef.current === e.target && onClose) {
      onClose();
    }
  };

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fadeIn"
    >
      <div
        className={`glass-panel p-6 rounded-3xl w-full shadow-[0_25px_60px_rgba(0,0,0,0.8)] border border-white/10 relative overflow-hidden transition-all duration-300 transform scale-100 ${maxWidthClass} ${className}`}
        {...props}
      >
        {/* Amber Ambient Glow Effect */}
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-amber-500/5 blur-3xl pointer-events-none" />

        {/* Modal Header */}
        <div className="flex justify-between items-start mb-5 relative z-10">
          <div>
            {subtitle && (
              <span className="text-[9px] font-bold uppercase tracking-widest text-amber-500 font-mono block">
                {subtitle}
              </span>
            )}
            {title && (
              <h2 className="text-sm font-extrabold uppercase tracking-widest text-slate-100 mt-0.5">
                {title}
              </h2>
            )}
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-200 transition-colors p-1 rounded-lg hover:bg-white/5"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Modal Content */}
        <div className="relative z-10 overflow-y-auto max-h-[70vh] no-scrollbar">
          {children}
        </div>

        {/* Modal Footer */}
        {footer && (
          <div className="flex gap-3 justify-end pt-5 mt-5 border-t border-white/5 relative z-10">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

export default Modal;
