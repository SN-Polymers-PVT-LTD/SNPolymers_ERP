import React from 'react';

const Button = ({
  children,
  type = 'button',
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  iconPosition = 'left',
  fullWidth = false,
  className = '',
  ...props
}) => {
  // Base classes for premium look
  const baseClasses = 'inline-flex items-center justify-center font-bold uppercase tracking-wider transition-all duration-300 select-none';

  // Variant styles
  const variants = {
    primary: 'bg-white hover:bg-slate-100 text-slate-950 shadow-md disabled:bg-white/50 disabled:text-slate-950/50',
    secondary: 'text-slate-400 hover:text-slate-200 disabled:opacity-40',
    glass: 'glass-input hover:border-white/20 text-slate-400 hover:text-slate-200 disabled:opacity-50',
    danger: 'bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 hover:border-red-500/30 disabled:opacity-50',
    success: 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/30 disabled:opacity-50',
    amber: 'bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-md shadow-amber-500/20 disabled:bg-amber-500/50 disabled:text-slate-950/50',
    ghost: 'p-1.5 rounded-lg hover:bg-white/5 border border-transparent hover:border-white/5 text-slate-400 hover:text-slate-200 disabled:opacity-40',
  };

  // Size styles
  const sizes = {
    xs: 'px-2.5 py-1.5 rounded-lg text-[10px]',
    sm: 'px-4 py-2 rounded-xl text-xs',
    md: 'px-6 py-3 rounded-xl text-xs',
    lg: 'px-8 py-4 rounded-2xl text-sm',
  };

  const widthClass = fullWidth ? 'w-full' : '';
  const loadingClass = loading || disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer';

  const variantClass = variants[variant] || variants.primary;
  const sizeClass = sizes[size] || sizes.md;

  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`${baseClasses} ${variantClass} ${sizeClass} ${widthClass} ${loadingClass} ${className}`}
      {...props}
    >
      {loading && (
        <svg className="animate-spin -ml-1 mr-2 h-3.5 w-3.5 text-current" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      )}
      
      {!loading && icon && iconPosition === 'left' && (
        <span className="mr-1.5 flex items-center">{icon}</span>
      )}
      
      <span>{children}</span>

      {!loading && icon && iconPosition === 'right' && (
        <span className="ml-1.5 flex items-center">{icon}</span>
      )}
    </button>
  );
};

export default Button;
