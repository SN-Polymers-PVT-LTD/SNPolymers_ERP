import { describe, it, expect, vi, beforeEach } from 'vitest';
const { supabase } = require('../../src/db/supabase');
const { getHoChartData } = require('../../src/controllers/analytics.controller');

describe('getHoChartData error handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns HTTP 500 when a database query fails', async () => {
    const failingResult = Promise.resolve({ data: null, error: { message: 'Simulated DB failure' } });
    const failingBuilder = {
      select: () => failingBuilder,
      eq: () => failingBuilder,
      gte: () => failingBuilder,
      order: () => failingBuilder,
      then: (...args) => failingResult.then(...args),
      catch: (...args) => failingResult.catch(...args),
      finally: (...args) => failingResult.finally(...args)
    };
    vi.spyOn(supabase, 'from').mockImplementation(() => failingBuilder);

    const req = { user: { role: 'ho', mobile_number: '9999999999' }, query: {} };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis()
    };
    await getHoChartData(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(false);
    expect(payload.message).toMatch(/failed to load analytics chart data/i);
  });
});
