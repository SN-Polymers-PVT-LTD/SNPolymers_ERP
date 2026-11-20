import { describe, it, expect, vi, beforeEach } from 'vitest';

const { reopenEstimate } = require('../../../src/controllers/estimates.workflow.controller');
const { transitionWorkflow } = require('../../../src/controllers/subcontractEstimates.controller');
const { supabase } = require('../../../src/db/supabase');
const telegramService = require('../../../src/services/telegram.service');

vi.mock('../../../src/db/supabase');
vi.mock('../../../src/services/telegram.service');
vi.mock('../../../src/services/subcontractCostEstimateSync.service', () => ({
  syncEditableCostEstimateForWorkOrderBestEffort: vi.fn().mockResolvedValue()
}));

describe('Estimate Reopen Authorization: moved from HO to ZO', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Cost Estimate Reopen Authorization', () => {
    const validEstimateId = '00000000-0000-0000-0000-000000000001';

    const buildQueryChain = (result) => {
      const chain = {
        select: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue(result),
        single: vi.fn().mockResolvedValue(result)
      };
      return chain;
    };

    it('allows ZO role to reopen a Cost Estimate', async () => {
      const estimateRecord = {
        estimate_id: validEstimateId,
        work_order_no: 'WO-100',
        estimate_status: 'Final Approved',
        estimate_amount: 50000,
        last_approved_amount: 50000
      };

      const updatedRecord = {
        ...estimateRecord,
        estimate_status: 'Estimate Reopened'
      };

      vi.spyOn(supabase, 'from').mockImplementation((table) => {
        if (table === 'project_cost_estimates') {
          const chain = buildQueryChain({ data: updatedRecord, error: null });
          // First select maybeSingle returns current record
          chain.maybeSingle = vi.fn().mockResolvedValue({ data: estimateRecord, error: null });
          return chain;
        }
        if (table === 'estimate_revision_log') {
          const chain = buildQueryChain({ data: null, error: null });
          chain.single = vi.fn().mockResolvedValue({
            data: { id: 'rev-1', estimate_id: validEstimateId, revision_cycle: 2 },
            error: null
          });
          return chain;
        }
        return buildQueryChain({ data: null, error: null });
      });

      const req = {
        params: { id: validEstimateId },
        user: { role: 'zo', mobile_number: '+918000000001' }
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      };

      await reopenEstimate(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        message: 'Estimate reopened successfully.'
      }));
    });

    it('allows Admin role to reopen a Cost Estimate', async () => {
      const estimateRecord = {
        estimate_id: validEstimateId,
        work_order_no: 'WO-100',
        estimate_status: 'Final Approved',
        estimate_amount: 50000,
        last_approved_amount: 50000
      };

      const updatedRecord = {
        ...estimateRecord,
        estimate_status: 'Estimate Reopened'
      };

      vi.spyOn(supabase, 'from').mockImplementation((table) => {
        if (table === 'project_cost_estimates') {
          const chain = buildQueryChain({ data: updatedRecord, error: null });
          chain.maybeSingle = vi.fn().mockResolvedValue({ data: estimateRecord, error: null });
          return chain;
        }
        if (table === 'estimate_revision_log') {
          const chain = buildQueryChain({ data: null, error: null });
          chain.single = vi.fn().mockResolvedValue({
            data: { id: 'rev-2', estimate_id: validEstimateId, revision_cycle: 1 },
            error: null
          });
          return chain;
        }
        return buildQueryChain({ data: null, error: null });
      });

      const req = {
        params: { id: validEstimateId },
        user: { role: 'admin', mobile_number: '+919999999999' }
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      };

      await reopenEstimate(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        message: 'Estimate reopened successfully.'
      }));
    });

    it('rejects HO role with 403 on Cost Estimate reopen', async () => {
      vi.spyOn(supabase, 'from').mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                estimate_id: validEstimateId,
                work_order_no: 'WO-100',
                estimate_status: 'Final Approved'
              },
              error: null
            })
          })
        })
      });

      const req = {
        params: { id: validEstimateId },
        user: { role: 'ho', mobile_number: '+917000000001' }
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      };

      await reopenEstimate(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        message: 'Access denied. Only ZO or Admin can reopen estimates.'
      }));
    });

    it('rejects JE role with 403 on Cost Estimate reopen', async () => {
      vi.spyOn(supabase, 'from').mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                estimate_id: validEstimateId,
                work_order_no: 'WO-100',
                estimate_status: 'Final Approved'
              },
              error: null
            })
          })
        })
      });

      const req = {
        params: { id: validEstimateId },
        user: { role: 'je', mobile_number: '+919000000001' }
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      };

      await reopenEstimate(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        message: 'Access denied. Only ZO or Admin can reopen estimates.'
      }));
    });
  });

  describe('Subcontract Estimate Reopen Authorization', () => {
    const validSubcontractEstimateId = '00000000-0000-0000-0000-000000000002';

    it('allows ZO role to transition workflow with REOPEN action', async () => {
      vi.spyOn(supabase, 'rpc').mockResolvedValue({ error: null });
      vi.spyOn(supabase, 'from').mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                subcontract_estimate_id: validSubcontractEstimateId,
                work_order_no: 'WO-200',
                estimate_status: 'Estimate Reopened',
                estimate_revision: 1
              },
              error: null
            })
          })
        })
      });
      vi.spyOn(telegramService, 'notifyJeSubcontractEstimateReopened').mockResolvedValue();

      const req = {
        params: { id: validSubcontractEstimateId },
        user: { role: 'zo', mobile_number: '+918000000001' },
        body: { action: 'REOPEN', remarks: 'ZO reopening estimate' }
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      };

      await transitionWorkflow(req, res);

      expect(supabase.rpc).toHaveBeenCalledWith('reopen_subcontract_estimate', expect.objectContaining({
        p_estimate_id: validSubcontractEstimateId,
        p_actor: '+918000000001',
        p_remarks: 'ZO reopening estimate'
      }));
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        message: 'Estimate reopened successfully.'
      }));
    });

    it('allows Admin role to transition workflow with REOPEN action', async () => {
      vi.spyOn(supabase, 'rpc').mockResolvedValue({ error: null });
      vi.spyOn(supabase, 'from').mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                subcontract_estimate_id: validSubcontractEstimateId,
                work_order_no: 'WO-200',
                estimate_status: 'Estimate Reopened',
                estimate_revision: 1
              },
              error: null
            })
          })
        })
      });
      vi.spyOn(telegramService, 'notifyJeSubcontractEstimateReopened').mockResolvedValue();

      const req = {
        params: { id: validSubcontractEstimateId },
        user: { role: 'admin', mobile_number: '+919999999999' },
        body: { action: 'REOPEN', remarks: 'Admin reopening estimate' }
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      };

      await transitionWorkflow(req, res);

      expect(supabase.rpc).toHaveBeenCalledWith('reopen_subcontract_estimate', expect.objectContaining({
        p_estimate_id: validSubcontractEstimateId,
        p_actor: '+919999999999',
        p_remarks: 'Admin reopening estimate'
      }));
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        message: 'Estimate reopened successfully.'
      }));
    });

    it('rejects HO role with 403 on Subcontract Estimate REOPEN', async () => {
      const req = {
        params: { id: validSubcontractEstimateId },
        user: { role: 'ho', mobile_number: '+917000000001' },
        body: { action: 'REOPEN', remarks: 'HO attempting reopen' }
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      };

      await transitionWorkflow(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        message: 'Only ZO or Admin may reopen an estimate.'
      }));
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it('rejects JE role with 403 on Subcontract Estimate REOPEN', async () => {
      const req = {
        params: { id: validSubcontractEstimateId },
        user: { role: 'je', mobile_number: '+919000000001' },
        body: { action: 'REOPEN', remarks: 'JE attempting reopen' }
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      };

      await transitionWorkflow(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        message: 'Only ZO or Admin may reopen an estimate.'
      }));
      expect(supabase.rpc).not.toHaveBeenCalled();
    });
  });
});
