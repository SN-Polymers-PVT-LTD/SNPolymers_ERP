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
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  if (abs >= 10000000) return `${sign}₹ ${(abs / 10000000).toFixed(2)} Cr`;
  if (abs >= 100000) return `${sign}₹ ${(abs / 100000).toFixed(2)} L`;
  return `${sign}₹ ${abs.toLocaleString('en-IN')}`;
};
