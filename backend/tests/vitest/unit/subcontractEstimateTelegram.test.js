import { describe, test, expect } from 'vitest';
const {
  notifyZoSubcontractEstimateSubmitted,
  notifyHoSubcontractEstimateApproved,
  getZoUsersForWorkOrder
} = require('../../../src/services/telegram.service');

describe('Subcontract Estimate Telegram Notifications Suite', () => {
  test('exports notifyZoSubcontractEstimateSubmitted, notifyHoSubcontractEstimateApproved, getZoUsersForWorkOrder', () => {
    expect(typeof notifyZoSubcontractEstimateSubmitted).toBe('function');
    expect(typeof notifyHoSubcontractEstimateApproved).toBe('function');
    expect(typeof getZoUsersForWorkOrder).toBe('function');
  });

  test('notifyZoSubcontractEstimateSubmitted executes safely without throwing in test mode', async () => {
    const mockEstimate = {
      subcontract_estimate_id: '11111111-1111-1111-1111-111111111111',
      work_order_no: 'WO-TEST-001',
      estimate_revision: 0,
      estimate_amount: 50000,
      estimate_status: 'Submitted'
    };

    await expect(
      notifyZoSubcontractEstimateSubmitted(mockEstimate, '919000000001', 'je', 'Initial submission')
    ).resolves.not.toThrow();
  });

  test('notifyHoSubcontractEstimateApproved executes safely without throwing in test mode', async () => {
    const mockEstimate = {
      subcontract_estimate_id: '11111111-1111-1111-1111-111111111111',
      work_order_no: 'WO-TEST-001',
      estimate_revision: 0,
      estimate_amount: 50000,
      estimate_status: 'ZO Approved'
    };

    await expect(
      notifyHoSubcontractEstimateApproved(mockEstimate, '919000000002', 'Approved by ZO')
    ).resolves.not.toThrow();
  });

  test('handles missing or malformed estimate objects gracefully', async () => {
    await expect(notifyZoSubcontractEstimateSubmitted(null, null)).resolves.not.toThrow();
    await expect(notifyHoSubcontractEstimateApproved(undefined, '1234567890')).resolves.not.toThrow();
  });
});
