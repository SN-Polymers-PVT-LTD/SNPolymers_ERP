import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The service captures the bot token at import time. Use a fake token before loading it.
const originalToken = process.env.TELEGRAM_BOT_TOKEN;
process.env.TELEGRAM_BOT_TOKEN = '123456:mock_token';
const telegramService = require('../../../src/services/telegram.service');
const { supabase } = require('../../../src/db/supabase');
const { transitionWorkflow } = require('../../../src/controllers/subcontractEstimates.controller');

describe('Subcontract Estimate JE Telegram Notifications', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalMode = process.env.TELEGRAM_MODE;
  const originalFetch = global.fetch;

  let capturedRequests = [];

  beforeEach(() => {
    vi.restoreAllMocks();
    capturedRequests = [];
    process.env.NODE_ENV = 'development';
    process.env.TELEGRAM_MODE = 'enabled';
    global.fetch = vi.fn(async (url) => {
      capturedRequests.push(url);
      return {
        json: async () => ({ ok: true, result: { message_id: 999 } })
      };
    });
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    process.env.TELEGRAM_MODE = originalMode;
    global.fetch = originalFetch;
  });

  afterAll(() => {
    if (originalToken === undefined) {
      delete process.env.TELEGRAM_BOT_TOKEN;
    } else {
      process.env.TELEGRAM_BOT_TOKEN = originalToken;
    }
  });

  describe('Service Exports', () => {
    it('exports all Subcontract Estimate Telegram notification helpers', () => {
      expect(typeof telegramService.getJeUsersForWorkOrder).toBe('function');
      expect(typeof telegramService.notifyZoSubcontractEstimateSubmitted).toBe('function');
      expect(typeof telegramService.notifyHoSubcontractEstimateApproved).toBe('function');
      expect(typeof telegramService.notifyJeSubcontractEstimateZoApproved).toBe('function');
      expect(typeof telegramService.notifyAllSubcontractEstimateFinalApproved).toBe('function');
      expect(typeof telegramService.notifyJeSubcontractEstimateRevisionRequested).toBe('function');
      expect(typeof telegramService.notifyJeSubcontractEstimateRejected).toBe('function');
      expect(typeof telegramService.notifyJeSubcontractEstimateReopened).toBe('function');
    });
  });

  describe('notifyJeSubcontractEstimateZoApproved', () => {
    it('formats and sends ZO approval alert to JE with amount and remarks', async () => {
      vi.spyOn(supabase, 'from').mockImplementation((table) => {
        if (table === 'authorised_users') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockImplementation((field, val) => {
              if (field === 'mobile_number') {
                const user = val === '+919000000001'
                  ? { mobile_number: '+919000000001', display_name: 'John JE', telegram_chat_id: 'chat-je-1' }
                  : { mobile_number: '+918000000001', display_name: 'Alice ZO', telegram_chat_id: 'chat-zo-1' };
                return {
                  eq: vi.fn().mockReturnThis(),
                  maybeSingle: vi.fn().mockResolvedValue({ data: user, error: null })
                };
              }
              return { maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
            })
          };
        }
        if (table === 'work_order_mappings') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
          };
        }
        if (table === 'projects_master') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { site_details: 'Sector 5 Pipe Project' },
              error: null
            })
          };
        }
        return { select: vi.fn().mockReturnThis() };
      });

      const estimate = {
        subcontract_estimate_id: '00000000-0000-0000-0000-000000000001',
        work_order_no: 'WO-101',
        estimate_revision: 0,
        estimate_amount: 75000,
        je_user_id: '+919000000001',
        zo_approved_by: '+918000000001',
        zo_remarks: 'Approved by ZO after rate verification'
      };

      await telegramService.notifyJeSubcontractEstimateZoApproved(estimate, '+918000000001', 'Approved by ZO after rate verification');

      expect(capturedRequests.length).toBe(1);
      const url = decodeURIComponent(capturedRequests[0]);
      expect(url).toContain('chat_id=chat-je-1');
      expect(url).toContain('Subcontract Estimate Approved by ZO');
      expect(url).toContain('WO-101');
      expect(url).toContain('Sector 5 Pipe Project');
      expect(url).toContain('75,000.00');
      expect(url).toContain('Alice ZO');
      expect(url).toContain('Approved by ZO after rate verification');
      expect(url).toContain('forwarded to Head Office');
    });
  });

  describe('notifyAllSubcontractEstimateFinalApproved', () => {
    it('broadcasts final approval to JE, ZO, and HO', async () => {
      vi.spyOn(supabase, 'from').mockImplementation((table) => {
        if (table === 'authorised_users') {
          let selectedRole = null;
          let selectedMobile = null;
          const chain = {
            select: vi.fn(),
            in: vi.fn(),
            eq: vi.fn((field, val) => {
              if (field === 'role') selectedRole = val;
              if (field === 'mobile_number') selectedMobile = val;
              return chain;
            }),
            not: vi.fn(() => {
              if (selectedRole === 'ho') {
                return Promise.resolve({
                  data: [{ display_name: 'Head Officer', telegram_chat_id: 'chat-ho-1' }],
                  error: null
                });
              }
              return Promise.resolve({ data: [], error: null });
            }),
            maybeSingle: vi.fn(() => {
              if (selectedMobile === '+919000000001') {
                return Promise.resolve({
                  data: { mobile_number: '+919000000001', display_name: 'John JE', telegram_chat_id: 'chat-je-1' },
                  error: null
                });
              }
              if (selectedMobile === '+917000000001') {
                return Promise.resolve({
                  data: { mobile_number: '+917000000001', display_name: 'Boss HO', telegram_chat_id: 'chat-ho-1' },
                  error: null
                });
              }
              return Promise.resolve({ data: null, error: null });
            })
          };
          chain.select.mockReturnValue(chain);
          chain.in.mockReturnValue(chain);
          return chain;
        }
        if (table === 'work_order_mappings' || table === 'je_zo_mappings') {
          const chain = {
            select: vi.fn(),
            eq: vi.fn(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
          };
          chain.select.mockReturnValue(chain);
          chain.eq.mockReturnValue(chain);
          return chain;
        }
        if (table === 'projects_master') {
          const chain = {
            select: vi.fn(),
            eq: vi.fn(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { site_details: 'Highway Bridge Site' },
              error: null
            })
          };
          chain.select.mockReturnValue(chain);
          chain.eq.mockReturnValue(chain);
          return chain;
        }
        return { select: vi.fn().mockReturnThis() };
      });

      const estimate = {
        subcontract_estimate_id: '00000000-0000-0000-0000-000000000002',
        work_order_no: 'WO-202',
        estimate_revision: 1,
        estimate_amount: 150000,
        je_user_id: '+919000000001',
        ho_approved_by: '+917000000001',
        ho_remarks: 'Final budget approved'
      };

      await telegramService.notifyAllSubcontractEstimateFinalApproved(estimate, '+917000000001', 'Final budget approved');

      expect(capturedRequests.length).toBeGreaterThanOrEqual(1);
      const url = decodeURIComponent(capturedRequests[0]);
      expect(url).toContain('Subcontract Estimate Approved by HO');
      expect(url).toContain('WO-202');
      expect(url).toContain('Highway Bridge Site');
      expect(url).toContain('1,50,000.00');
      expect(url).toContain('Final budget approved');
      expect(url).toContain('The subcontract estimate has been approved by Head Office.');
    });
  });

  describe('notifyJeSubcontractEstimateRevisionRequested', () => {
    it('formats revision request with unapproved row counts and deadline', async () => {
      vi.spyOn(supabase, 'from').mockImplementation((table) => {
        if (table === 'authorised_users') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockImplementation((field, val) => {
              if (field === 'mobile_number') {
                const user = val === '+919000000001'
                  ? { mobile_number: '+919000000001', display_name: 'John JE', telegram_chat_id: 'chat-je-1' }
                  : { mobile_number: '+918000000001', display_name: 'Alice ZO', telegram_chat_id: 'chat-zo-1' };
                return {
                  eq: vi.fn().mockReturnThis(),
                  maybeSingle: vi.fn().mockResolvedValue({ data: user, error: null })
                };
              }
              return { maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
            })
          };
        }
        if (table === 'work_order_mappings') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
          };
        }
        if (table === 'projects_master') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { site_details: 'Metro Station Work' },
              error: null
            })
          };
        }
        return { select: vi.fn().mockReturnThis() };
      });

      const estimate = {
        subcontract_estimate_id: '00000000-0000-0000-0000-000000000003',
        work_order_no: 'WO-303',
        estimate_revision: 0,
        estimate_status: 'ZO Revision Requested',
        je_user_id: '+919000000001',
        zo_remarks: 'Plumbing rate too high, please reduce',
        project_subcontract_estimate_lines: [
          { line_id: 'l1', zo_office_approve: 'Approve', final_approved_revision: null },
          { line_id: 'l2', zo_office_approve: 'Not Approve', final_approved_revision: null },
          { line_id: 'l3', zo_office_approve: 'Not Approve', final_approved_revision: null },
          { line_id: 'l4', zo_office_approve: 'Approve', final_approved_revision: 0 } // historical, excluded
        ]
      };

      const revisionLog = {
        revision_cycle: 1,
        stage: 'ZO',
        requested_by: '+918000000001',
        revision_deadline: '2026-09-20T10:00:00.000Z'
      };

      await telegramService.notifyJeSubcontractEstimateRevisionRequested(
        estimate,
        '+918000000001',
        'Plumbing rate too high, please reduce',
        revisionLog
      );

      expect(capturedRequests.length).toBe(1);
      const url = decodeURIComponent(capturedRequests[0]);
      expect(url).toContain('chat_id=chat-je-1');
      expect(url).toContain('Subcontract Estimate Revision Requested (ZO)');
      expect(url).toContain('WO-303');
      expect(url).toContain('Metro Station Work');
      expect(url).toContain('Revision Cycle:</b> 1');
      expect(url).toContain('Alice ZO');
      expect(url).toContain('2 out of 3 rows not approved');
      expect(url).toContain('Plumbing rate too high, please reduce');
      expect(url).toContain('Please review the remarks and resubmit the revised estimate');
    });
  });

  describe('notifyJeSubcontractEstimateRejected', () => {
    it('formats rejection notification for ZO rejection', async () => {
      vi.spyOn(supabase, 'from').mockImplementation((table) => {
        if (table === 'authorised_users') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockImplementation((field, val) => {
              if (field === 'mobile_number') {
                const user = val === '+919000000001'
                  ? { mobile_number: '+919000000001', display_name: 'John JE', telegram_chat_id: 'chat-je-1' }
                  : { mobile_number: '+918000000001', display_name: 'Alice ZO', telegram_chat_id: 'chat-zo-1' };
                return {
                  eq: vi.fn().mockReturnThis(),
                  maybeSingle: vi.fn().mockResolvedValue({ data: user, error: null })
                };
              }
              return { maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
            })
          };
        }
        if (table === 'work_order_mappings') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
          };
        }
        if (table === 'projects_master') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { site_details: 'Substation Alpha' },
              error: null
            })
          };
        }
        return { select: vi.fn().mockReturnThis() };
      });

      const estimate = {
        subcontract_estimate_id: '00000000-0000-0000-0000-000000000004',
        work_order_no: 'WO-404',
        estimate_revision: 0,
        estimate_amount: 50000,
        estimate_status: 'Rejected by ZO',
        je_user_id: '+919000000001',
        zo_approved_by: '+918000000001',
        zo_remarks: 'Subcontractor not certified'
      };

      await telegramService.notifyJeSubcontractEstimateRejected(estimate, '+918000000001', 'Subcontractor not certified');

      expect(capturedRequests.length).toBe(1);
      const url = decodeURIComponent(capturedRequests[0]);
      expect(url).toContain('chat_id=chat-je-1');
      expect(url).toContain('Subcontract Estimate Rejected');
      expect(url).toContain('WO-404');
      expect(url).toContain('Alice ZO (Zonal Office)');
      expect(url).toContain('Subcontractor not certified');
      expect(url).toContain('Your subcontract estimate has been rejected');
    });
  });

  describe('notifyJeSubcontractEstimateReopened', () => {
    it('formats reopen alert with ZO actor and remarks', async () => {
      vi.spyOn(supabase, 'from').mockImplementation((table) => {
        if (table === 'authorised_users') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockImplementation((field, val) => {
              if (field === 'mobile_number') {
                const user = val === '+919000000001'
                  ? { mobile_number: '+919000000001', display_name: 'John JE', telegram_chat_id: 'chat-je-1', role: 'je' }
                  : { mobile_number: '+917000000001', display_name: 'Boss ZO', telegram_chat_id: 'chat-zo-1', role: 'zo' };
                return {
                  eq: vi.fn().mockReturnThis(),
                  maybeSingle: vi.fn().mockResolvedValue({ data: user, error: null })
                };
              }
              return { maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
            })
          };
        }
        if (table === 'work_order_mappings') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
          };
        }
        if (table === 'projects_master') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { site_details: 'Airport Drainage' },
              error: null
            })
          };
        }
        return { select: vi.fn().mockReturnThis() };
      });

      const estimate = {
        subcontract_estimate_id: '00000000-0000-0000-0000-000000000005',
        work_order_no: 'WO-505',
        estimate_revision: 2,
        je_user_id: '+919000000001'
      };

      await telegramService.notifyJeSubcontractEstimateReopened(estimate, '+917000000001', 'Reopening for additional scope');

      expect(capturedRequests.length).toBe(1);
      const url = decodeURIComponent(capturedRequests[0]);
      expect(url).toContain('chat_id=chat-je-1');
      expect(url).toContain('Subcontract Estimate Reopened (ZO)');
      expect(url).toContain('WO-505');
      expect(url).toContain('Airport Drainage');
      expect(url).toContain('Boss ZO (Zonal Office)');
      expect(url).toContain('Reopening for additional scope');
      expect(url).toContain('prepare the revised subcontract estimate');
    });
  });

  describe('Controller Workflow Trigger Integration', () => {
    it('dispatches notifyJeSubcontractEstimateZoApproved when action is ZO_APPROVE', async () => {
      const notifySpy = vi.spyOn(telegramService, 'notifyJeSubcontractEstimateZoApproved').mockResolvedValue();
      vi.spyOn(telegramService, 'notifyHoSubcontractEstimateApproved').mockResolvedValue();

      vi.spyOn(supabase, 'rpc').mockResolvedValue({ error: null });
      vi.spyOn(supabase, 'from').mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            subcontract_estimate_id: 'est-1',
            work_order_no: 'WO-101',
            estimate_status: 'ZO Approved',
            estimate_revision: 0,
            je_user_id: '+919000000001'
          },
          error: null
        })
      });

      const req = {
        params: { id: 'est-1' },
        user: { mobile_number: '+918000000001', role: 'zo' },
        body: { action: 'ZO_APPROVE', remarks: 'Good job' }
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      };

      await transitionWorkflow(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({ subcontract_estimate_id: 'est-1' }),
        '+918000000001',
        'Good job'
      );
    });

    it('dispatches notifyAllSubcontractEstimateFinalApproved when action is HO_APPROVE', async () => {
      const notifySpy = vi.spyOn(telegramService, 'notifyAllSubcontractEstimateFinalApproved').mockResolvedValue();

      vi.spyOn(supabase, 'rpc').mockResolvedValue({ error: null });
      vi.spyOn(supabase, 'from').mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            subcontract_estimate_id: 'est-2',
            work_order_no: 'WO-202',
            estimate_status: 'Final Approved',
            estimate_revision: 0,
            je_user_id: '+919000000001'
          },
          error: null
        })
      });

      const req = {
        params: { id: 'est-2' },
        user: { mobile_number: '+917000000001', role: 'ho' },
        body: { action: 'HO_APPROVE', remarks: 'Final ok' }
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      };

      await transitionWorkflow(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({ subcontract_estimate_id: 'est-2' }),
        '+917000000001',
        'Final ok'
      );
    });

    it('dispatches notifyJeSubcontractEstimateRevisionRequested when action is ZO_REQUEST_REVISION', async () => {
      const notifySpy = vi.spyOn(telegramService, 'notifyJeSubcontractEstimateRevisionRequested').mockResolvedValue();

      vi.spyOn(supabase, 'rpc').mockResolvedValue({ error: null });
      const mockEstimate = {
        subcontract_estimate_id: 'est-3',
        work_order_no: 'WO-303',
        estimate_status: 'ZO Revision Requested',
        estimate_revision: 0,
        subcontract_estimate_revision_log: [
          { revision_cycle: 1, stage: 'ZO', requested_by: '+918000000001' }
        ]
      };
      vi.spyOn(supabase, 'from').mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: mockEstimate,
          error: null
        })
      });

      const req = {
        params: { id: 'est-3' },
        user: { mobile_number: '+918000000001', role: 'zo' },
        body: { action: 'ZO_REQUEST_REVISION', remarks: 'Need rate revision', deadline_hours: 48 }
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      };

      await transitionWorkflow(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({ subcontract_estimate_id: 'est-3' }),
        '+918000000001',
        'Need rate revision',
        expect.objectContaining({ revision_cycle: 1, stage: 'ZO' })
      );
    });

    it('dispatches notifyJeSubcontractEstimateReopened when action is REOPEN', async () => {
      const notifySpy = vi.spyOn(telegramService, 'notifyJeSubcontractEstimateReopened').mockResolvedValue();

      vi.spyOn(supabase, 'rpc').mockResolvedValue({ error: null });
      vi.spyOn(supabase, 'from').mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            subcontract_estimate_id: 'est-4',
            work_order_no: 'WO-404',
            estimate_status: 'Estimate Reopened',
            estimate_revision: 1
          },
          error: null
        })
      });

      const req = {
        params: { id: 'est-4' },
        user: { mobile_number: '+917000000001', role: 'zo' },
        body: { action: 'REOPEN', remarks: 'Reopening estimate for extra works' }
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      };

      await transitionWorkflow(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({ subcontract_estimate_id: 'est-4' }),
        '+917000000001',
        'Reopening estimate for extra works'
      );
    });

    it('rejects REOPEN with 403 when attempted by HO', async () => {
      const req = {
        params: { id: 'est-4' },
        user: { mobile_number: '+917000000001', role: 'ho' },
        body: { action: 'REOPEN', remarks: 'HO trying to reopen' }
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
    });
  });
});
