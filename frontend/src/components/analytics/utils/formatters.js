// Shared currency formatters for HO and ZO analytics dashboards.

export const formatINR = (value) => {
  const num = Number(value) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(num);
};

export const fmtCr = (n) => {
  const v = Number(n) || 0;
  if (v >= 10000000) return `₹ ${(v / 10000000).toFixed(2)} Cr`;
  if (v >= 100000) return `₹ ${(v / 100000).toFixed(2)} L`;
  return `₹ ${v.toLocaleString('en-IN')}`;
};
