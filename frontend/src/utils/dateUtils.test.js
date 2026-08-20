import { describe, it, expect, vi, afterEach } from 'vitest';
import { isWithinLastNDays, formatDateDDMMYYYY } from './dateUtils';

describe('isWithinLastNDays', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns false for null/undefined/empty', () => {
    expect(isWithinLastNDays(null, 30)).toBe(false);
    expect(isWithinLastNDays(undefined, 30)).toBe(false);
    expect(isWithinLastNDays('', 30)).toBe(false);
  });

  it('returns false for invalid date string', () => {
    expect(isWithinLastNDays('not-a-date', 30)).toBe(false);
  });

  it('returns true for date within window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-03T12:00:00Z'));
    expect(isWithinLastNDays('2026-08-01T00:00:00Z', 30)).toBe(true);
  });

  it('returns false for date outside window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-03T12:00:00Z'));
    expect(isWithinLastNDays('2026-06-01T00:00:00Z', 30)).toBe(false);
  });

  it('returns true at boundary (exactly N days ago)', () => {
    vi.useFakeTimers();
    const now = new Date('2026-08-03T12:00:00Z');
    vi.setSystemTime(now);
    const exactly30DaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(isWithinLastNDays(exactly30DaysAgo, 30)).toBe(true);
  });
});

describe('formatDateDDMMYYYY', () => {
  it('formats an ISO timestamp as dd/mm/yyyy with no time component', () => {
    expect(formatDateDDMMYYYY('2026-08-19T08:00:00Z')).toBe('19/08/2026');
  });

  it('pads single-digit day/month', () => {
    expect(formatDateDDMMYYYY('2026-01-05T00:00:00Z')).toBe('05/01/2026');
  });

  it('returns an empty string for null/undefined/invalid input', () => {
    expect(formatDateDDMMYYYY(null)).toBe('');
    expect(formatDateDDMMYYYY(undefined)).toBe('');
    expect(formatDateDDMMYYYY('not-a-date')).toBe('');
  });

  it('reads the UTC calendar date, unaffected by the runtime timezone', () => {
    // 2026-01-01T00:30:00Z would fall on 2025-12-31 in a negative-offset
    // timezone if this went through toLocaleDateString's local-time
    // conversion — it must not.
    expect(formatDateDDMMYYYY('2026-01-01T00:30:00Z')).toBe('01/01/2026');
  });
});
