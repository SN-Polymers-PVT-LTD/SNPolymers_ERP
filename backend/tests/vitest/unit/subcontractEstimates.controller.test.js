import { beforeEach, describe, expect, it, vi } from 'vitest';

const { supabase } = require('../../../src/db/supabase');
const { reconcileLines } = require('../../../src/controllers/subcontractEstimates.controller');

describe('subcontract estimate line reconciliation controller', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 422 for protected approved-line edits rejected by the workflow', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({ error: { code: 'P4B59', message: 'Approved rows cannot be modified during revision.' } });
    const req = {
      params: { id: '11111111-1111-1111-1111-111111111111' },
      user: { mobile_number: 'je-user' },
      body: { expected_updated_at: '2026-09-19T10:00:00.000Z', lines: [] }
    };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis()
    };

    await reconcileLines(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Approved rows cannot be modified during revision.',
      code: 'P4B59'
    });
  });
});
