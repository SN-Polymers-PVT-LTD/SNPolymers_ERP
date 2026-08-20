import React from 'react';

// Main Table Wrapper
export const Table = ({ children, className = '', containerClassName = '', ...props }) => {
  return (
    <div className={`overflow-x-auto w-full no-scrollbar ${containerClassName}`}>
      <table className={`w-full text-left border-collapse ${className}`} {...props}>
        {children}
      </table>
    </div>
  );
};

// Table Header Wrapper
export const TableHeader = ({ children, className = '', ...props }) => {
  return (
    <thead className={`border-b border-white/5 bg-white/[0.02] text-[9px] uppercase tracking-widest text-slate-500 ${className}`} {...props}>
      {children}
    </thead>
  );
};

// Table Body Wrapper
export const TableBody = ({ children, className = '', ...props }) => {
  return (
    <tbody className={`divide-y divide-white/5 text-xs text-slate-300 ${className}`} {...props}>
      {children}
    </tbody>
  );
};

// Table Row
export const TableRow = React.forwardRef(({
  children,
  className = '',
  hover = true,
  interactive = false,
  ...props
}, ref) => {
  const hoverClass = hover ? 'hover:bg-white/[0.025] transition-colors duration-200' : '';
  const interactiveClass = interactive ? 'cursor-pointer group' : '';

  return (
    <tr
      ref={ref}
      className={`${hoverClass} ${interactiveClass} ${className}`}
      {...props}
    >
      {children}
    </tr>
  );
});
TableRow.displayName = 'TableRow';

// Table Cell (handles both th and td)
export const TableCell = ({
  children,
  isHeader = false,
  align = 'left', // 'left' | 'center' | 'right'
  size = 'md', // 'sm' | 'md'
  className = '',
  ...props
}) => {
  const Tag = isHeader ? 'th' : 'td';
  
  const alignStyles = {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right',
  };

  const sizeStyles = {
    sm: 'p-3',
    md: 'py-4 px-5',
  };

  const alignClass = alignStyles[align] || alignStyles.left;
  const sizeClass = sizeStyles[size] || sizeStyles.md;
  const headerClass = isHeader ? 'font-extrabold whitespace-nowrap' : '';

  return (
    <Tag
      className={`${sizeClass} ${alignClass} ${headerClass} ${className}`}
      {...props}
    >
      {children}
    </Tag>
  );
};
