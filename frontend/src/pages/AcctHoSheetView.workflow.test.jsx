import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import AcctHoSheetView from './AcctHoSheetView';
import {
  renderPage,
  createDeferred,
  interceptApiCall,
  assertApiCalledWith
} from '../test';
import { acctSheetDetailFixture } from '../test/fixtures/domainFixtures';
import authApi from '../api/authApi';

vi.mock('../api/authApi');

describe('AcctHoSheetView Workflow Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const submittedSheetFixture = {
    ...acctSheetDetailFixture,
    sheet_status: 'Submitted',
    status: 'Submitted',
    items: [
      {
        id: 'item-ho-01',
        item_id: 'item-ho-01',
        requisition_no: 'REQ-2026-001',
        work_order_no: 'WO-101',
        particulars: 'Diesel Refill for Generator',
        req_amount: 50000,
        requisition_status: 'Pending HO Review',
        beneficiary_name: 'National Suppliers Corp',
        beneficiary_ac_no: '123456789012',
        beneficiary_ifsc: 'SBIN0001234',
        debit_bank_ac_type: 'State Bank of India'
      }
    ]
  };

  describe('Batch Review Decisions Workflow', () => {
    it('stages a decision, verifies in-flight loading state, asserts batch API payload, and displays confirmation', async () => {
      renderPage(<AcctHoSheetView />, {
        role: 'ho',
        initialUrl: '/acct-requisitions/ho-queue/sheets/1',
        routePath: '/acct-requisitions/ho-queue/sheets/:id',
        overrides: {
          '/acct-requisitions/sheets/1': {
            success: true,
            sheet: submittedSheetFixture,
            sheetDetail: submittedSheetFixture,
            items: submittedSheetFixture.items
          }
        }
      });

      const deferred = createDeferred();
      const batchInterceptor = interceptApiCall(authApi, 'post', (url) => url.includes('/items/batch-action'), {
        deferred,
        response: {
          success: true,
          results: [{ line_item_id: 'item-ho-01', success: true }]
        }
      });

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1, name: /SHEET-2026-01/i })).toBeInTheDocument();
      });

      // Find decision select dropdown (only one in actionable table)
      const decisionSelect = screen.getByRole('combobox');
      fireEvent.change(decisionSelect, { target: { value: 'Approve' } });

      // Staged indicator appears
      expect(await screen.findByText('Staged')).toBeInTheDocument();

      // Submit Decisions button becomes enabled
      const submitDecisionsBtn = screen.getByRole('button', { name: /Submit Decisions/i });
      expect(submitDecisionsBtn).not.toBeDisabled();

      fireEvent.click(submitDecisionsBtn);

      // Verify in-flight loading state
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Submit Decisions/i })).toBeDisabled();
      });

      // Assert intercepted API payload
      expect(batchInterceptor.calls.length).toBe(1);
      assertApiCalledWith(batchInterceptor, {
        url: '/acct-requisitions/sheets/1/items/batch-action',
        partialBody: {
          actions: [
            {
              line_item_id: 'item-ho-01',
              action: 'Approve'
            }
          ]
        }
      });

      // Resolve deferred batch
      deferred.resolve({
        data: {
          success: true,
          results: [{ line_item_id: 'item-ho-01', success: true }]
        }
      });

      // Confirm modal feedback
      await waitFor(() => {
        expect(screen.getByText('Review Submitted')).toBeInTheDocument();
        expect(screen.getByText('Your decisions have been recorded for this sheet.')).toBeInTheDocument();
      });
    });

    it('handles partial failure gracefully and retains unapplied decisions with error message', async () => {
      const multiItemSheet = {
        ...submittedSheetFixture,
        items: [
          {
            id: 'item-01',
            item_id: 'item-01',
            requisition_no: 'REQ-2026-001',
            work_order_no: 'WO-101',
            particulars: 'Diesel Refill for Generator',
            req_amount: 30000,
            requisition_status: 'Pending HO Review',
            beneficiary_name: 'National Suppliers Corp',
            debit_bank_ac_type: 'State Bank of India'
          },
          {
            id: 'item-02',
            item_id: 'item-02',
            requisition_no: 'REQ-2026-002',
            work_order_no: 'WO-101',
            particulars: 'Cement Bags',
            req_amount: 80000,
            requisition_status: 'Pending HO Review',
            beneficiary_name: 'Apex Cement Ltd',
            debit_bank_ac_type: 'State Bank of India'
          }
        ]
      };

      renderPage(<AcctHoSheetView />, {
        role: 'ho',
        initialUrl: '/acct-requisitions/ho-queue/sheets/1',
        routePath: '/acct-requisitions/ho-queue/sheets/:id',
        overrides: {
          '/acct-requisitions/sheets/1': {
            success: true,
            sheet: multiItemSheet,
            sheetDetail: multiItemSheet,
            items: multiItemSheet.items
          }
        }
      });

      interceptApiCall(authApi, 'post', (url) => url.includes('/items/batch-action'), {
        response: {
          success: true,
          results: [
            { line_item_id: 'item-01', success: true },
            { line_item_id: 'item-02', success: false, error_message: 'Insufficient bank balance for disbursement' }
          ]
        }
      });

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1, name: /SHEET-2026-01/i })).toBeInTheDocument();
      });

      const selects = screen.getAllByRole('combobox');
      expect(selects.length).toBeGreaterThanOrEqual(2);
      fireEvent.change(selects[0], { target: { value: 'Approve' } });
      fireEvent.change(selects[1], { target: { value: 'Approve' } });

      const submitDecisionsBtn = screen.getByRole('button', { name: /Submit Decisions/i });
      fireEvent.click(submitDecisionsBtn);

      // Verifies partial failure message
      await waitFor(() => {
        expect(screen.getByText('1 of 2 decision(s) failed — check the errors below.')).toBeInTheDocument();
      });

      // Item 2 error shown inline
      expect(screen.getByText('Insufficient bank balance for disbursement')).toBeInTheDocument();
    });
  });

  describe('Close Review Workflow', () => {
    it('closes review early with confirmation and success modal', async () => {
      renderPage(<AcctHoSheetView />, {
        role: 'ho',
        initialUrl: '/acct-requisitions/ho-queue/sheets/1',
        routePath: '/acct-requisitions/ho-queue/sheets/:id',
        overrides: {
          '/acct-requisitions/sheets/1': {
            success: true,
            sheet: submittedSheetFixture,
            sheetDetail: submittedSheetFixture,
            items: submittedSheetFixture.items
          }
        }
      });

      const deferred = createDeferred();
      const closeInterceptor = interceptApiCall(authApi, 'post', '/close-review', {
        deferred,
        response: { success: true }
      });

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1, name: /SHEET-2026-01/i })).toBeInTheDocument();
      });

      const closeReviewBtn = screen.getByRole('button', { name: /Close Review/i });
      fireEvent.click(closeReviewBtn);

      // Confirmation dialog opens
      expect(await screen.findByRole('heading', { name: /Close Review\?/i })).toBeInTheDocument();

      const modalCloseReviewBtn = screen.getAllByRole('button', { name: /Close Review/i })[1];
      fireEvent.click(modalCloseReviewBtn);

      // In-flight state
      await waitFor(() => {
        expect(modalCloseReviewBtn).toBeDisabled();
      });

      expect(closeInterceptor.calls.length).toBe(1);
      expect(closeInterceptor.calls[0].url).toContain('/acct-requisitions/sheets/1/close-review');

      deferred.resolve({ data: { success: true } });

      // Verifies modal feedback
      await waitFor(() => {
        expect(screen.getByText('Review Closed')).toBeInTheDocument();
        expect(screen.getByText(/Remaining undecided items have moved to the pending queue/i)).toBeInTheDocument();
      });
    });
  });

  describe('Role Authorization', () => {
    it('denies access to non-HO roles (e.g. je)', async () => {
      renderPage(<AcctHoSheetView />, {
        role: 'je',
        initialUrl: '/acct-requisitions/ho-queue/sheets/1',
        routePath: '/acct-requisitions/ho-queue/sheets/:id'
      });

      expect(screen.getByText('Access denied.')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 1, name: /SHEET-2026-01/i })).not.toBeInTheDocument();
    });
  });
});
