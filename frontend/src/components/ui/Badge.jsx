import React from 'react';

const Badge = ({
  children,
  variant = 'slate', // 'slate' | 'amber' | 'emerald' | 'red' | 'blue' | 'indigo'
  showDot = true,
  pulseDot = false,
  className = '',
  ...props
}) => {
  const configs = {
    slate: {
      pill: 'bg-slate-500/10 border-slate-500/25 text-slate-400',
      dot: 'bg-slate-400',
    },
    amber: {
      pill: 'bg-amber-500/10 border-amber-500/25 text-amber-400',
      dot: 'bg-amber-400',
    },
    orange: {
      pill: 'bg-orange-500/10 border-orange-500/25 text-orange-400',
      dot: 'bg-orange-400',
    },
    emerald: {
      pill: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400',
      dot: 'bg-emerald-400',
    },
    red: {
      pill: 'bg-red-500/10 border-red-500/25 text-red-400',
      dot: 'bg-red-400',
    },
    blue: {
      pill: 'bg-blue-500/10 border-blue-500/25 text-blue-400',
      dot: 'bg-blue-400',
    },
    indigo: {
      pill: 'bg-indigo-500/10 border-indigo-500/25 text-indigo-400',
      dot: 'bg-indigo-400',
    },
    purple: {
      pill: 'bg-purple-500/10 border-purple-500/25 text-purple-400',
      dot: 'bg-purple-400',
    },
    violet: {
      pill: 'bg-purple-500/10 border-purple-500/25 text-purple-400',
      dot: 'bg-purple-400',
    },
  };

  // Support aliases used in existing badges
  const colorKey = 
    variant === 'green' ? 'emerald' : 
    variant === 'grey' ? 'slate' : 
    variant;

  const current = configs[colorKey] || configs.slate;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider border select-none ${current.pill} ${className}`}
      {...props}
    >
      {showDot && (
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          {pulseDot && (
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${current.dot}`} />
          )}
          <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${current.dot}`} />
        </span>
      )}
      <span>{children}</span>
    </span>
  );
};

export default Badge;
