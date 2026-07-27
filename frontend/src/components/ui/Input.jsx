import React from 'react';

const Input = React.forwardRef(({
  label,
  error,
  helperText,
  type = 'text',
  iconLeft,
  iconRight,
  required = false,
  className = '',
  containerClassName = '',
  size = 'md', // 'sm' | 'md' | 'lg'
  ...props
}, ref) => {
  const sizeStyles = {
    sm: 'px-3 py-2 text-xs rounded-xl',
    md: 'px-4 py-3 text-sm rounded-xl',
    lg: 'px-5 py-4 text-base rounded-2xl',
  };

  const inputSizeClass = sizeStyles[size] || sizeStyles.md;
  const errorClass = error ? 'border-red-500/50 focus:border-red-500' : '';
  const paddingLeftClass = iconLeft ? 'pl-11' : '';
  const paddingRightClass = iconRight ? 'pr-11' : '';

  return (
    <div className={`flex flex-col w-full text-left ${containerClassName}`}>
      {label && (
        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
          {label} {required && <span className="text-red-400">*</span>}
        </label>
      )}

      <div className="relative flex items-center w-full">
        {iconLeft && (
          <div className="absolute left-4 text-slate-400 pointer-events-none flex items-center justify-center">
            {iconLeft}
          </div>
        )}

        <input
          ref={ref}
          type={type}
          required={required}
          onWheel={(e) => {
            if (type === 'number') {
              e.target.blur();
            }
            if (props.onWheel) props.onWheel(e);
          }}
          className={`w-full glass-input focus:ring-0 outline-none font-semibold text-slate-100 transition duration-200 ${inputSizeClass} ${paddingLeftClass} ${paddingRightClass} ${errorClass} ${className}`}
          {...props}
        />

        {iconRight && (
          <div className="absolute right-4 text-slate-400 pointer-events-none flex items-center justify-center">
            {iconRight}
          </div>
        )}
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

Input.displayName = 'Input';

export default Input;
