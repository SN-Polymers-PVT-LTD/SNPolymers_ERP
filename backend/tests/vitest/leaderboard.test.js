import { describe, it, expect, vi, beforeEach } from 'vitest';
const { supabase } = require('../../src/db/supabase');
const { getJeLeaderboard } = require('../../src/controllers/analytics.controller');

describe('Analytics Controller - JE Leaderboard', () => {
  let req, res;

  beforeEach(() => {
    vi.restoreAllMocks();

    req = { query: { timeframe: 'weekly' } };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis()
    };

    const mockUsers = [
      { mobile_number: '+919000000001', display_name: 'Active JE 1', role: 'je', daily_streak: 5, is_active: true },
      { mobile_number: '+919000000002', display_name: 'Active JE 2', role: 'je', daily_streak: 2, is_active: true },
      { mobile_number: '+919000000003', display_name: 'Deactivated JE', role: 'je', daily_streak: 10, is_active: false }
    ];

    const mockReports = [
      { report_id: '1', created_by: '+919000000001', physical_work_progress: 50, site_visit_date: '2026-07-20', approval_status: 'Approved' },
      { report_id: '2', created_by: '+919000000001', physical_work_progress: 70, site_visit_date: '2026-07-21', approval_status: 'Approved' },
      { report_id: '3', created_by: '+919000000002', physical_work_progress: 30, site_visit_date: '2026-07-21', approval_status: 'Pending' },
      { report_id: '4', created_by: '+919000000003', physical_work_progress: 90, site_visit_date: '2026-07-21', approval_status: 'Approved' }
    ];

    vi.spyOn(supabase, 'from').mockImplementation((table) => {
      if (table === 'authorised_users') {
        const builder = {
          select: () => builder,
          eq: () => builder,
          then: (resolve) => resolve({ data: mockUsers.filter(u => u.role === 'je' && u.is_active), error: null })
        };
        return builder;
      }
      if (table === 'daily_progress_reports') {
        const builder = {
          select: () => builder,
          gte: () => builder,
          then: (resolve) => resolve({ data: mockReports, error: null })
        };
        return builder;
      }
      return { select: () => Promise.resolve({ data: [], error: null }) };
    });
  });

  it('should return 200 and calculate correct ranking scores for active JEs only', async () => {
    await getJeLeaderboard(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const jsonCall = res.json.mock.calls[0][0];
    expect(jsonCall.success).toBe(true);
    expect(jsonCall.leaderboard).toBeDefined();

    // Verify Deactivated JE is excluded
    const deactivatedUser = jsonCall.leaderboard.find(u => u.mobile_number === '+919000000003');
    expect(deactivatedUser).toBeUndefined();

    // Verify Active JE 1 is Ranked #1
    const topJe = jsonCall.leaderboard[0];
    expect(topJe.rank).toBe(1);
    expect(topJe.mobile_number).toBe('+919000000001');
    expect(topJe.total_reports).toBe(2);
    expect(topJe.approved_reports).toBe(2);
    expect(topJe.avg_progress).toBe(60);
    // Score formula: (2*20) + (5*10) + (60*2) + (2*15) = 40 + 50 + 120 + 30 = 240
    expect(topJe.score).toBe(240);
  });

  it('should support monthly and lifetime timeframe query parameters', async () => {
    req.query.timeframe = 'monthly';
    await getJeLeaderboard(req, res);
    expect(res.status).toHaveBeenCalledWith(200);

    req.query.timeframe = 'lifetime';
    await getJeLeaderboard(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
