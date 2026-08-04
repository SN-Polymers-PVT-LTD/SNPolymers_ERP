import { describe, it, expect } from 'vitest';
import { getLatestDprByVisitDate, computeConsecutiveStreakFromVisitDates } from './dprUtils';

describe('getLatestDprByVisitDate', () => {
  it('returns null for empty array', () => {
    expect(getLatestDprByVisitDate([])).toBeNull();
  });

  it('picks later site_visit_date even when progress is lower', () => {
    const reports = [
      { site_visit_date: '2026-08-01', physical_work_progress: 80, created_at: '2026-08-01T10:00:00Z' },
      { site_visit_date: '2026-08-03', physical_work_progress: 50, created_at: '2026-08-03T10:00:00Z' }
    ];
    const latest = getLatestDprByVisitDate(reports);
    expect(latest.physical_work_progress).toBe(50);
    expect(latest.site_visit_date).toBe('2026-08-03');
  });

  it('picks newer site_visit_date regardless of submission order (backdated entry)', () => {
    const reports = [
      { site_visit_date: '2026-08-03', physical_work_progress: 60, created_at: '2026-08-03T14:00:00Z' },
      { site_visit_date: '2026-08-01', physical_work_progress: 90, created_at: '2026-08-03T16:00:00Z' }
    ];
    const latest = getLatestDprByVisitDate(reports);
    expect(latest.site_visit_date).toBe('2026-08-03');
    expect(latest.physical_work_progress).toBe(60);
  });

  it('tiebreaks same site_visit_date by latest created_at', () => {
    const reports = [
      { site_visit_date: '2026-08-02', physical_work_progress: 40, created_at: '2026-08-02T09:00:00Z' },
      { site_visit_date: '2026-08-02', physical_work_progress: 55, created_at: '2026-08-02T15:00:00Z' }
    ];
    const latest = getLatestDprByVisitDate(reports);
    expect(latest.physical_work_progress).toBe(55);
    expect(latest.created_at).toBe('2026-08-02T15:00:00Z');
  });
});

describe('computeConsecutiveStreakFromVisitDates', () => {
  it('counts consecutive calendar days, not unique date count', () => {
    const dates = ['2026-08-03', '2026-08-02', '2026-08-01', '2026-07-28'];
    expect(computeConsecutiveStreakFromVisitDates(dates)).toBe(3);
  });

  it('returns 0 for empty input', () => {
    expect(computeConsecutiveStreakFromVisitDates([])).toBe(0);
  });
});
