import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import FundRequests from './FundRequests';
import {
  renderPage,
  createDeferred,
  interceptApiCall,
  assertApiCalledWith
} from '../test';
import {
  fundRequestsFixture,
  projectsFixture
} from '../test/fixtures/domainFixtures';
import authApi from '../api/authApi';

vi.mock('../api/authApi');

describe('Fund Requests Workflow Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Create Draft Workflow', () => {
    it('creates a fund request draft with payload assertion, in-flight state, and feedback', async () => {
      renderPage(<FundRequests />, {
        role: 'zo',
        initialUrl: '/fund-requests?create=true'
      });

      const deferred = createDeferred();
      const draftInterceptor = interceptApiCall(authApi, 'post', '/fund-requests', {
        deferred,
        response: {
          success: true,
          fundRequest: {
            fund_request_id: 'fr-draft-new',
            zo_fr_no: 'ZO/FR/2026/099',
            zo_fr_amount: 25000,
            request_status: 'Draft'
          }
        }
      });

      // Wait for creation panel to load
      await waitFor(() => {
        expect(screen.getByText('Work Order (Project)')).toBeInTheDocument();
      });

      // Select Work Order (first combobox on the page)
      const selects = screen.getAllByRole('combobox');
      fireEvent.change(selects[0], { target: { value: 'WO-101' } });

      // Enter Request Number
      const frNoInput = screen.getByPlaceholderText('ZO/FR/2026/001');
      fireEvent.change(frNoInput, { target: { value: 'ZO/FR/2026/099' } });

      // Enter Amount
      const amountInput = screen.getByPlaceholderText('0.00');
      fireEvent.change(amountInput, { target: { value: '25000' } });

      // Enter Remarks
      const remarksTextarea = screen.getByPlaceholderText('Add request remarks...');
      fireEvent.change(remarksTextarea, { target: { value: 'Site cement procurement' } });

      // Click "Save Draft"
      const saveDraftBtn = screen.getByRole('button', { name: /Save Draft/i });
      fireEvent.click(saveDraftBtn);

      // Verify in-flight loading state
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Saving\.\.\./i })).toBeDisabled();
      });

      // Assert intercepted API payload
      expect(draftInterceptor.calls.length).toBe(1);
      assertApiCalledWith(draftInterceptor, {
        url: '/fund-requests',
        partialBody: {
          work_order_no: 'WO-101',
          zo_fr_no: 'ZO/FR/2026/099',
          zo_fr_amount: 25000,
          zo_remarks: 'Site cement procurement',
          submission_mode: 'draft'
        }
      });

      // Resolve deferred promise
      deferred.resolve({
        data: {
          success: true,
          fundRequest: {
            fund_request_id: 'fr-draft-new',
            zo_fr_no: 'ZO/FR/2026/099',
            zo_fr_amount: 25000,
            request_status: 'Draft'
          }
        }
      });

      // Verify success modal feedback
      await waitFor(() => {
        expect(screen.getByText(/saved as draft/i)).toBeInTheDocument();
      });
    });
  });

  describe('Create and Submit (Two-Step Sequencing)', () => {
    it('executes create draft followed by submit in sequential order with valid beneficiary', async () => {
      renderPage(<FundRequests />, {
        role: 'zo',
        initialUrl: '/fund-requests?create=true'
      });

      const draftInterceptor = interceptApiCall(authApi, 'post', (url) => url === '/fund-requests', {
        response: {
          success: true,
          fundRequest: {
            fund_request_id: 'fr-step-100',
            zo_fr_no: 'ZO/FR/2026/100',
            zo_fr_amount: 35000
          }
        }
      });

      const deferredSubmit = createDeferred();
      const submitInterceptor = interceptApiCall(authApi, 'post', '/submit', {
        deferred: deferredSubmit,
        response: { success: true }
      });

      await waitFor(() => {
        expect(screen.getByText('Work Order (Project)')).toBeInTheDocument();
      });

      const selects = screen.getAllByRole('combobox');
      fireEvent.change(selects[0], { target: { value: 'WO-101' } });
      fireEvent.change(screen.getByPlaceholderText('ZO/FR/2026/001'), { target: { value: 'ZO/FR/2026/100' } });
      fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '35000' } });
      fireEvent.change(screen.getByPlaceholderText('Add request remarks...'), { target: { value: 'Urgent electrical cable supply' } });

      // Fill beneficiary fields required for final submission (Payee name first to avoid resetting acct/ifsc)
      fireEvent.change(screen.getByPlaceholderText('Enter payee name…'), { target: { value: 'Pioneer Cable Works' } });
      fireEvent.change(screen.getByPlaceholderText('Enter bank account no…'), { target: { value: '987654321001' } });
      fireEvent.change(screen.getByPlaceholderText('e.g. SBIN0001234'), { target: { value: 'SBIN0001234' } });
      const bankSelect = document.getElementById('select-indian-banks');
      if (bankSelect) fireEvent.change(bankSelect, { target: { value: 'bank-01' } });

      const submitBtn = screen.getByRole('button', { name: /Submit Request/i });
      fireEvent.click(submitBtn);

      // Verify Step 1 occurred immediately
      await waitFor(() => {
        expect(draftInterceptor.calls.length).toBe(1);
      });
      assertApiCalledWith(draftInterceptor, {
        url: '/fund-requests',
        partialBody: {
          work_order_no: 'WO-101',
          zo_fr_no: 'ZO/FR/2026/100',
          zo_fr_amount: 35000,
          submission_mode: 'submit'
        }
      });

      // Verify Step 2 is called with the ID returned by Step 1
      await waitFor(() => {
        expect(submitInterceptor.calls.length).toBe(1);
      });
      expect(submitInterceptor.calls[0].url).toContain('/fund-requests/fr-step-100/submit');

      // Resolve step 2
      deferredSubmit.resolve({ data: { success: true } });

      // Verify success feedback
      await waitFor(() => {
        expect(screen.getByText(/submitted successfully/i)).toBeInTheDocument();
      });
    });

    it('safely handles failure at Step 1 without triggering Step 2', async () => {
      renderPage(<FundRequests />, {
        role: 'zo',
        initialUrl: '/fund-requests?create=true'
      });

      interceptApiCall(authApi, 'post', (url) => url === '/fund-requests', {
        isError: true,
        status: 400,
        response: { message: 'Work order budget exhausted' }
      });

      const submitInterceptor = interceptApiCall(authApi, 'post', '/submit', {
        response: { success: true }
      });

      await waitFor(() => {
        expect(screen.getByText('Work Order (Project)')).toBeInTheDocument();
      });

      const selects = screen.getAllByRole('combobox');
      fireEvent.change(selects[0], { target: { value: 'WO-101' } });
      fireEvent.change(screen.getByPlaceholderText('ZO/FR/2026/001'), { target: { value: 'ZO/FR/2026/101' } });
      fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '50000' } });
      fireEvent.change(screen.getByPlaceholderText('Add request remarks...'), { target: { value: 'Testing failure' } });

      fireEvent.change(screen.getByPlaceholderText('Enter payee name…'), { target: { value: 'Pioneer Cable Works' } });
      fireEvent.change(screen.getByPlaceholderText('Enter bank account no…'), { target: { value: '987654321001' } });
      fireEvent.change(screen.getByPlaceholderText('e.g. SBIN0001234'), { target: { value: 'SBIN0001234' } });
      const bankSelect = document.getElementById('select-indian-banks');
      if (bankSelect) fireEvent.change(bankSelect, { target: { value: 'bank-01' } });

      fireEvent.click(screen.getByRole('button', { name: /Submit Request/i }));

      // Error message shown in panel
      await waitFor(() => {
        expect(screen.getByText('Work order budget exhausted')).toBeInTheDocument();
      });

      // Submit step 2 was NEVER invoked
      expect(submitInterceptor.calls.length).toBe(0);
      expect(screen.queryByText(/submitted successfully/i)).not.toBeInTheDocument();
    });

    it('safely surfaces error when Step 2 fails without a false success message', async () => {
      renderPage(<FundRequests />, {
        role: 'zo',
        initialUrl: '/fund-requests?create=true'
      });

      interceptApiCall(authApi, 'post', (url) => url === '/fund-requests', {
        response: {
          success: true,
          fundRequest: { fund_request_id: 'fr-fail-2', zo_fr_no: 'ZO/FR/2026/102' }
        }
      });

      interceptApiCall(authApi, 'post', '/submit', {
        isError: true,
        status: 500,
        response: { message: 'Submission to Accounts gateway failed' }
      });

      await waitFor(() => {
        expect(screen.getByText('Work Order (Project)')).toBeInTheDocument();
      });

      const selects = screen.getAllByRole('combobox');
      fireEvent.change(selects[0], { target: { value: 'WO-101' } });
      fireEvent.change(screen.getByPlaceholderText('ZO/FR/2026/001'), { target: { value: 'ZO/FR/2026/102' } });
      fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '12000' } });
      fireEvent.change(screen.getByPlaceholderText('Add request remarks...'), { target: { value: 'Testing step 2 failure' } });

      fireEvent.change(screen.getByPlaceholderText('Enter payee name…'), { target: { value: 'Pioneer Cable Works' } });
      fireEvent.change(screen.getByPlaceholderText('Enter bank account no…'), { target: { value: '987654321001' } });
      fireEvent.change(screen.getByPlaceholderText('e.g. SBIN0001234'), { target: { value: 'SBIN0001234' } });
      const bankSelect = document.getElementById('select-indian-banks');
      if (bankSelect) fireEvent.change(bankSelect, { target: { value: 'bank-01' } });

      fireEvent.click(screen.getByRole('button', { name: /Submit Request/i }));

      // Error banner surfaced
      await waitFor(() => {
        expect(screen.getByText('Submission to Accounts gateway failed')).toBeInTheDocument();
      });

      // Must NOT display success message
      expect(screen.queryByText(/submitted successfully/i)).not.toBeInTheDocument();
    });
  });

  describe('Edit Existing Draft Workflow', () => {
    it('updates an unsubmitted draft via PATCH with updated payload', async () => {
      const draftItem = {
        fund_request_id: 'fr-draft-exist',
        fund_request_no: 'FR-DRAFT-1',
        zo_fr_no: 'FR-DRAFT-1',
        work_order_no: 'WO-101',
        zo_fr_amount: 15000,
        request_status: 'Draft',
        zo_user_id: '+919876543212',
        zo_remarks: 'Initial draft remarks',
        created_at: '2026-09-20T00:00:00Z'
      };

      renderPage(<FundRequests />, {
        role: 'zo',
        initialUrl: '/fund-requests?req=fr-draft-exist',
        overrides: {
          '/fund-requests': { success: true, fundRequests: [draftItem, ...fundRequestsFixture], data: [draftItem, ...fundRequestsFixture] }
        }
      });

      const updateInterceptor = interceptApiCall(authApi, 'patch', '/fund-requests/fr-draft-exist', {
        response: { success: true }
      });

      // Wait for draft detail to load
      await waitFor(() => {
        expect(screen.getByDisplayValue('FR-DRAFT-1')).toBeInTheDocument();
      });

      // Change amount to 20000
      const amountInput = screen.getByPlaceholderText('0.00');
      fireEvent.change(amountInput, { target: { value: '20000' } });

      // Click "Save Draft"
      const saveDraftBtn = screen.getByRole('button', { name: /Save Draft/i });
      fireEvent.click(saveDraftBtn);

      await waitFor(() => {
        expect(updateInterceptor.calls.length).toBe(1);
      });

      assertApiCalledWith(updateInterceptor, {
        url: '/fund-requests/fr-draft-exist',
        partialBody: {
          zo_fr_amount: 20000,
          submission_mode: 'draft'
        }
      });

      await waitFor(() => {
        expect(screen.getByText(/Fund request draft saved/i)).toBeInTheDocument();
      });
    });
  });

  describe('Cancel Fund Request Workflow', () => {
    it('cancels a pending fund request with confirmation modal and status update', async () => {
      renderPage(<FundRequests />, {
        role: 'zo',
        initialUrl: '/fund-requests'
      });

      const deferred = createDeferred();
      const cancelInterceptor = interceptApiCall(authApi, 'patch', '/cancel', {
        deferred,
        response: { success: true }
      });

      await waitFor(() => {
        expect(screen.getByText('Fund Request Dashboard')).toBeInTheDocument();
      });

      // Find "Cancel" button on the pending row
      const cancelButtons = await screen.findAllByRole('button', { name: /^Cancel$/i });
      expect(cancelButtons.length).toBeGreaterThan(0);
      fireEvent.click(cancelButtons[0]);

      // Confirm modal opens
      expect(await screen.findByRole('heading', { name: /Cancel Request/i })).toBeInTheDocument();

      const confirmBtn = screen.getByRole('button', { name: /Confirm Cancel/i });
      fireEvent.click(confirmBtn);

      // Loading state on button
      await waitFor(() => {
        expect(confirmBtn).toBeDisabled();
      });

      expect(cancelInterceptor.calls.length).toBe(1);
      expect(cancelInterceptor.calls[0].url).toContain('/cancel');

      deferred.resolve({ data: { success: true } });

      await waitFor(() => {
        expect(screen.getByText(/cancelled successfully/i)).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: /Cancel Request/i })).not.toBeInTheDocument();
      });
    });
  });
});
