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

/**
 * dd/mm/yyyy, no time component. Reads UTC fields directly rather than
 * going through toLocaleDateString — the latter renders in the machine's
 * local timezone, which can shift the calendar date across a midnight
 * boundary depending on where the code runs (dev machine vs. server vs. a
 * user's browser), giving a different date for the same timestamp.
 */
export const formatDateDDMMYYYY = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
};
