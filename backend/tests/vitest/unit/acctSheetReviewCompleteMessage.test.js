import { describe, test, expect } from 'vitest';
const { buildReviewCompleteMessage } = require('../../../src/services/telegram.service');

// Return/Reject used to each fire their own Telegram message the instant HO
// actioned an item (notifyAcctLineItemActed, now removed) — on a large sheet
// that meant one ping per item, back-to-back, as HO worked through the
// queue. Their details are now folded into this one end-of-review summary
// instead, built once per review session rather than once per action.
describe('buildReviewCompleteMessage — folds Returned/Rejected items into one summary', () => {
  test('includes every Returned/Rejected item\'s particulars, amount, and remarks', () => {
    const items = [
      { particulars: 'Approved item', requisition_status: 'Approved', req_amount: 1000, ho_pass_amount: 1000 },
      { particulars: 'Returned item', requisition_status: 'Returned for Correction', req_amount: 2000, ho_remarks: 'Missing IFSC' },
      { particulars: 'Rejected item', requisition_status: 'Rejected', req_amount: 3000, ho_remarks: 'Duplicate request' }
    ];

    const message = buildReviewCompleteMessage('19082026-1', items);

    expect(message).toContain('Returned item');
    expect(message).toContain('Missing IFSC');
    expect(message).toContain('Rejected item');
    expect(message).toContain('Duplicate request');
    expect(message).toContain('Approved:</b> 1');
    expect(message).toContain('Returned for Correction:</b> 1');
    expect(message).toContain('Rejected:</b> 1');
  });

  test('does not add a "Needs your attention" section when nothing was returned/rejected', () => {
    const items = [
      { particulars: 'Approved item A', requisition_status: 'Approved', req_amount: 1000, ho_pass_amount: 1000 },
      { particulars: 'Approved item B', requisition_status: 'Partially Approved', req_amount: 2000, ho_pass_amount: 1500 }
    ];

    const message = buildReviewCompleteMessage('19082026-2', items);

    expect(message).not.toContain('Needs your attention');
  });

  test('sums approvedAmount from ho_pass_amount across Approved and Partially Approved only', () => {
    const items = [
      { particulars: 'A', requisition_status: 'Approved', req_amount: 1000, ho_pass_amount: 1000 },
      { particulars: 'B', requisition_status: 'Partially Approved', req_amount: 2000, ho_pass_amount: 1500 },
      { particulars: 'C', requisition_status: 'Rejected', req_amount: 5000, ho_remarks: 'No' }
    ];

    const message = buildReviewCompleteMessage('19082026-3', items);

    expect(message).toContain('Total Approved Amount:</b> ₹2,500.00');
  });

  test('escapes HTML in particulars and remarks (untrusted free-text fields)', () => {
    const items = [
      { particulars: '<script>alert(1)</script>', requisition_status: 'Rejected', req_amount: 100, ho_remarks: '<b>bad</b>' }
    ];

    const message = buildReviewCompleteMessage('19082026-4', items);

    expect(message).not.toContain('<script>');
    expect(message).toContain('&lt;script&gt;');
  });

  test('handles an item with no remarks gracefully', () => {
    const items = [
      { particulars: 'No remarks item', requisition_status: 'Returned for Correction', req_amount: 500 }
    ];

    const message = buildReviewCompleteMessage('19082026-5', items);

    expect(message).toContain('No remarks item');
    expect(message).not.toContain('undefined');
  });
});
