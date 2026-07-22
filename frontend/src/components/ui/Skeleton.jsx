import React from 'react';

/**
 * Base Skeleton Element
 */
export const Skeleton = ({
  className = '',
  variant = 'text', // 'text' | 'circular' | 'rectangular'
  width,
  height,
  style = {},
  ...props
}) => {
  const variantClasses = {
    text: 'rounded-md',
    circular: 'rounded-full',
    rectangular: 'rounded-xl',
  };

  return (
    <div
      className={`animate-pulse bg-white/10 dark:bg-white/10 light:bg-slate-200 ${variantClasses[variant] || 'rounded-md'} ${className}`}
      style={{
        width,
        height,
        ...style,
      }}
      {...props}
    />
  );
};

/**
 * Skeleton Card Placeholder
 */
export const SkeletonCard = ({ className = '' }) => (
  <div className={`glass-panel p-6 rounded-3xl space-y-4 ${className}`}>
    <div className="flex items-center gap-4">
      <Skeleton variant="circular" className="w-12 h-12 shrink-0" />
      <div className="space-y-2 flex-1">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-1/4" />
      </div>
    </div>
    <div className="space-y-2.5 pt-2">
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-5/6" />
      <Skeleton className="h-3 w-4/6" />
    </div>
  </div>
);

/**
 * Skeleton Table Placeholder
 */
export const SkeletonTable = ({ rows = 5, cols = 6, className = '' }) => (
  <div className={`w-full overflow-hidden ${className}`}>
    <div className="divide-y divide-white/5">
      {/* Header skeleton */}
      <div className="flex items-center px-6 py-4 bg-white/[0.02] gap-4">
        {Array.from({ length: cols }).map((_, cIdx) => (
          <Skeleton key={cIdx} className="h-3.5 flex-1" />
        ))}
      </div>
      {/* Rows skeleton */}
      {Array.from({ length: rows }).map((_, rIdx) => (
        <div key={rIdx} className="flex items-center px-6 py-4 gap-4">
          {Array.from({ length: cols }).map((_, cIdx) => (
            <Skeleton
              key={cIdx}
              className={`h-3.5 flex-1 ${cIdx === 0 ? 'w-1/4 font-bold' : ''}`}
            />
          ))}
        </div>
      ))}
    </div>
  </div>
);

/**
 * Skeleton Full Page Layout (For Suspense & Chunk Loading)
 */
export const SkeletonPage = () => (
  <div className="w-full space-y-8 max-w-7xl mx-auto p-2 md:p-4">
    {/* Top Header Bar Skeleton */}
    <div className="flex justify-between items-center pb-6 border-b border-white/5">
      <div className="space-y-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-64" />
      </div>
      <Skeleton className="h-10 w-32 rounded-xl" />
    </div>

    {/* Metrics Row Skeleton */}
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="glass-panel p-5 rounded-2xl space-y-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-28" />
        </div>
      ))}
    </div>

    {/* Main Table/Panel Skeleton */}
    <div className="glass-panel p-6 rounded-3xl space-y-4">
      <Skeleton className="h-5 w-44" />
      <SkeletonTable rows={5} cols={5} />
    </div>
  </div>
);

export default Skeleton;
