import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import AcctRequisitionSheetView from './AcctRequisitionSheetView';
import {
  renderPage,
  createDeferred,
  interceptApiCall,
  assertApiCalledWith
} from '../test';
import { acctSheetDetailFixture } from '../test/fixtures/domainFixtures';
import authApi from '../api/authApi';

vi.mock('../api/authApi');

describe('AcctRequisitionSheetView Workflow Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Add Line Item Workflow', () => {
    it('adds a line item with optimistic pending state, API assertion, and resolution', async () => {
      renderPage(<AcctRequisitionSheetView />, {
        role: 'accounts',
        initialUrl: '/acct-requisitions/sheets/1',
        routePath: '/acct-requisitions/sheets/:id'
      });

      const deferred = createDeferred();
      const addInterceptor = interceptApiCall(authApi, 'post', '/acct-requisitions/sheets/1/items', {
        deferred,
        response: {
          success: true,
          item: {
            id: 'item-new-99',
            item_id: 'item-new-99',
            requisition_no: 'REQ-2026-099',
            work_order_no: 'WO-101',
            particular: 'Safety Helmets & Jackets',
            amount: 15000,
            status: 'Draft',
            beneficiary_name: 'Industrial Safety Supplies',
            account_number: '987654321001',
            ifsc: 'SBIN0001234'
          }
        }
      });

      // Wait for sheet view to load
      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1, name: /SHEET-2026-01/i })).toBeInTheDocument();
      });

      const addBtn = screen.getByRole('button', { name: /\+ Add Line Item/i });
      fireEvent.click(addBtn);

      // Verify in-flight disabled / loading state
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /\+ Add Line Item/i })).toBeDisabled();
      });

      // Intercepted API assertion
      expect(addInterceptor.calls.length).toBe(1);
      assertApiCalledWith(addInterceptor, {
        url: '/acct-requisitions/sheets/1/items',
        partialBody: {}
      });

      // Resolve creation
      deferred.resolve({
        data: {
          success: true,
          item: {
            id: 'item-new-99',
            item_id: 'item-new-99',
            requisition_no: 'REQ-2026-099',
            work_order_no: 'WO-101',
            particular: 'Safety Helmets & Jackets',
            amount: 15000,
            status: 'Draft',
            beneficiary_name: 'Industrial Safety Supplies',
            account_number: '987654321001',
            ifsc: 'SBIN0001234'
          }
        }
      });

      // Verify button returns to enabled state
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /\+ Add Line Item/i })).not.toBeDisabled();
      });
    });
  });

  describe('Delete Line Item Workflow', () => {
    it('deletes a line item with in-flight state and updates table', async () => {
      const openSheetWithActionableItem = {
        ...acctSheetDetailFixture,
        items: [
          {
            id: 'item-actionable-01',
            item_id: 'item-actionable-01',
            requisition_no: 'REQ-2026-001',
            work_order_no: 'WO-101',
            particulars: 'Diesel Refill for Generator',
            req_amount: 50000,
            requisition_status: null,
            beneficiary_name: 'National Suppliers Corp',
            beneficiary_ac_no: '123456789012',
            beneficiary_ifsc: 'SBIN0001234'
          }
        ]
      };

      renderPage(<AcctRequisitionSheetView />, {
        role: 'accounts',
        initialUrl: '/acct-requisitions/sheets/1',
        routePath: '/acct-requisitions/sheets/:id',
        overrides: {
          '/acct-requisitions/sheets/1': {
            success: true,
            sheet: openSheetWithActionableItem,
            sheetDetail: openSheetWithActionableItem,
            items: openSheetWithActionableItem.items
          }
        }
      });

      const deferred = createDeferred();
      const deleteInterceptor = interceptApiCall(authApi, 'delete', (url) => url.includes('/acct-requisitions/sheets/1/items/'), {
        deferred,
        response: { success: true }
      });

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1, name: /SHEET-2026-01/i })).toBeInTheDocument();
      });

      const deleteBtn = await screen.findByRole('button', { name: /Delete line item/i });
      fireEvent.click(deleteBtn);

      // In-flight state
      await waitFor(() => {
        expect(deleteBtn).toBeDisabled();
      });

      expect(deleteInterceptor.calls.length).toBe(1);
      expect(deleteInterceptor.calls[0].url).toContain('item-actionable-01');

      deferred.resolve({ data: { success: true } });

      // Verifies row is removed from DOM
      await waitFor(() => {
        expect(screen.queryByDisplayValue('Diesel Refill for Generator')).not.toBeInTheDocument();
      });
    });
  });

  describe('Submit Sheet Workflow', () => {
    it('submits sheet to HO with in-flight state and premium success confirmation', async () => {
      renderPage(<AcctRequisitionSheetView />, {
        role: 'accounts',
        initialUrl: '/acct-requisitions/sheets/1',
        routePath: '/acct-requisitions/sheets/:id'
      });

      const deferred = createDeferred();
      const submitInterceptor = interceptApiCall(authApi, 'post', '/acct-requisitions/sheets/1/submit', {
        deferred,
        response: { success: true }
      });

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1, name: /SHEET-2026-01/i })).toBeInTheDocument();
      });

      const submitBtn = screen.getByRole('button', { name: /Submit Sheet/i });
      fireEvent.click(submitBtn);

      // Verify in-flight disabled state
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Submit Sheet/i })).toBeDisabled();
      });

      expect(submitInterceptor.calls.length).toBe(1);

      deferred.resolve({ data: { success: true } });

      // Modal confirmation displayed
      await waitFor(() => {
        expect(screen.getByText('Sheet Submitted')).toBeInTheDocument();
        expect(screen.getByText('This sheet has been sent to HO for review.')).toBeInTheDocument();
      });
    });

    it('gracefully handles submit sheet error and displays error banner', async () => {
      renderPage(<AcctRequisitionSheetView />, {
        role: 'accounts',
        initialUrl: '/acct-requisitions/sheets/1',
        routePath: '/acct-requisitions/sheets/:id'
      });

      interceptApiCall(authApi, 'post', '/acct-requisitions/sheets/1/submit', {
        isError: true,
        status: 400,
        response: { message: 'All line items must have a valid debit bank assigned before submission' }
      });

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1, name: /SHEET-2026-01/i })).toBeInTheDocument();
      });

      const submitBtn = screen.getByRole('button', { name: /Submit Sheet/i });
      fireEvent.click(submitBtn);

      // Error banner
      await waitFor(() => {
        expect(screen.getByText('All line items must have a valid debit bank assigned before submission')).toBeInTheDocument();
      });

      // No success modal
      expect(screen.queryByText('Sheet Submitted')).not.toBeInTheDocument();
    });
  });
});
