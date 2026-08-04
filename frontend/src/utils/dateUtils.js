/**
 * Returns true if dateStr falls within the last N days from now.
 */
export const isWithinLastNDays = (dateStr, days) => {
  if (!dateStr) return false;
  const parsed = Date.parse(dateStr);
  if (Number.isNaN(parsed)) return false;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return parsed >= cutoff;
};
