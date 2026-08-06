const FROZEN_ISO = '2026-06-15T10:00:00+05:30';

async function withFrozenTime(isoDate, fn) {
  const { vi } = await import('vitest');
  // Only freeze Date — real timers must keep running for Supabase/async I/O.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(isoDate));
  try {
    return await fn();
  } finally {
    vi.useRealTimers();
  }
}

module.exports = {
  FROZEN_ISO,
  withFrozenTime
};
