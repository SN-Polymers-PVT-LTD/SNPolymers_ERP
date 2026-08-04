import { describe, it, expect, vi, afterEach } from 'vitest';
import { isWithinLastNDays } from './dateUtils';

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
