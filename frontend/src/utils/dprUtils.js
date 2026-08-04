/**
 * Returns the DPR with the most recent site_visit_date (visit date entered by operator).
 * Tiebreaker: latest created_at when visit dates match.
 * O(n) linear scan — no array allocation or sort.
 */
export const getLatestDprByVisitDate = (reports = []) => {
  let latest = null;

  for (const report of reports) {
    if (!latest) {
      latest = report;
      continue;
    }

    // YYYY-MM-DD strings compare lexicographically — safe for ISO dates
    if (report.site_visit_date > latest.site_visit_date) {
      latest = report;
      continue;
    }

    if (report.site_visit_date === latest.site_visit_date) {
      const reportCreated = Date.parse(report.created_at || '');
      const latestCreated = Date.parse(latest.created_at || '');
      if (reportCreated > latestCreated) {
        latest = report;
      }
    }
  }

  return latest;
};

/** Count consecutive calendar days ending at the most recent visit date. */
export const computeConsecutiveStreakFromVisitDates = (dates = []) => {
  const dateSet = new Set(dates.filter(Boolean));
  if (dateSet.size === 0) return 0;

  const toUtcDateStr = (dateStr) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - 1);
    return dt.toISOString().slice(0, 10);
  };

  const sorted = [...dateSet].sort((a, b) => b.localeCompare(a));
  let streak = 1;
  let expectedPrev = toUtcDateStr(sorted[0]);

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === expectedPrev) {
      streak++;
      expectedPrev = toUtcDateStr(sorted[i]);
    } else {
      break;
    }
  }
  return streak;
};
