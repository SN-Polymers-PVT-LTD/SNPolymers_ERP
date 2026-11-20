import React from 'react';
import InPageSelect from './InPageSelect';

export const InPageSelectContext = React.createContext(false);

const Select = React.forwardRef(({
  label,
  error,
  helperText,
  options = [],
  required = false,
  className = '',
  containerClassName = '',
  size = 'md', // 'sm' | 'md' | 'lg'
  children,
  ...props
}, ref) => {
  const sizeStyles = {
    sm: 'px-3 py-2 text-xs rounded-xl',
    md: 'px-4 py-3 text-sm rounded-xl',
    lg: 'px-5 py-4 text-base rounded-2xl',
  };

  const selectSizeClass = sizeStyles[size] || sizeStyles.md;
  const errorClass = error ? 'border-red-500/50 focus:border-red-500' : '';
  const selectId = props.id || (label ? `select-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : undefined);

  const inPage = React.useContext(InPageSelectContext);
  if (inPage && !children) {
    return (
      <div className={containerClassName}>
        <InPageSelect label={label} required={required} value={props.value} disabled={props.disabled}
          options={options} onChange={value => props.onChange?.({ target: { value } })} />
        {(error || helperText) && <p className={error ? 'text-xs text-red-500' : 'text-xs text-slate-500'}>{error || helperText}</p>}
      </div>
    );
  }

  return (
    <div className={`flex flex-col w-full text-left ${containerClassName}`}>
      {label && (
        <label htmlFor={selectId} className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
          {label} {required && <span className="text-red-400">*</span>}
        </label>
      )}

      <div className="relative flex items-center w-full">
        <select
          ref={ref}
          id={selectId}
          required={required}
          className={`w-full glass-input focus:ring-0 outline-none font-semibold text-slate-100 transition duration-200 cursor-pointer appearance-none ${selectSizeClass} ${errorClass} ${className}`}
          {...props}
        >
          {children ? children : (
            <>
              {options.map((opt) => (
                <option key={opt.value} value={opt.value} className="bg-slate-950 text-slate-200 font-semibold">
                  {opt.label}
                </option>
              ))}
            </>
          )}
        </select>
        
        {/* Custom Chevron Indicator */}
        <div className="absolute right-4 pointer-events-none text-slate-400 flex items-center justify-center">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {error && (
        <span className="mt-1.5 text-[10px] font-semibold text-red-400 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
          {error}
        </span>
      )}

      {!error && helperText && (
        <span className="mt-1.5 text-[10px] text-slate-500">
          {helperText}
        </span>
      )}
    </div>
  );
});

Select.displayName = 'Select';

export default Select;
