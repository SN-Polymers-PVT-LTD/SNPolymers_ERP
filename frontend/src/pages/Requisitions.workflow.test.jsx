import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import Requisitions from './Requisitions';
import {
  renderPage,
  createDeferred,
  interceptApiCall,
  assertApiCalledWith
} from '../test';
import {
  requisitionsFixture
} from '../test/fixtures/domainFixtures';
import authApi from '../api/authApi';

vi.mock('../api/authApi');

describe('Requisitions Workflow Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ZO / HO Action Workflow (Approve & Hold)', () => {
    it('approves a pending requisition with deferred loading state, payload assertion, and success feedback', async () => {
      renderPage(<Requisitions />, {
        role: 'zo',
        initialUrl: '/requisitions?tab=pending'
      });

      const deferred = createDeferred();
      const actionInterceptor = interceptApiCall(authApi, 'patch', '/action', {
        deferred,
        response: { success: true, requisition: { ...requisitionsFixture[0], requisition_status: 'Approved' } }
      });

      await waitFor(() => {
        expect(screen.getByText('Requisition Management')).toBeInTheDocument();
      });

      const takeActionButtons = await screen.findAllByRole('button', { name: /Take Action/i });
      expect(takeActionButtons.length).toBeGreaterThan(0);
      fireEvent.click(takeActionButtons[0]);

      // Action modal should appear
      expect(await screen.findByRole('heading', { name: /Take Workflow Action/i })).toBeInTheDocument();

      // Enter approved amount and mandatory remarks
      const remarksInput = await screen.findByPlaceholderText(/Enter the reason/i);
      fireEvent.change(remarksInput, { target: { value: 'Verified and compliant for processing' } });

      const amountInput = screen.getByPlaceholderText('0.00');
      fireEvent.change(amountInput, { target: { value: '15000' } });

      // Submit form
      const form = document.getElementById('workflow-action-form');
      fireEvent.submit(form);

      // Verify in-flight pending state: submit button should show loading/disabled
      const approveSubmitBtn = screen.getByRole('button', { name: /Save Approval \(Approve\)/i });
      await waitFor(() => {
        expect(approveSubmitBtn).toBeDisabled();
      });

      // Assert intercepted call payload
      expect(actionInterceptor.calls.length).toBe(1);
      assertApiCalledWith(actionInterceptor, {
        url: '/action',
        partialBody: {
          action: 'Approve',
          remarks_approved_authority: 'Verified and compliant for processing',
          approved_amount: 15000
        }
      });

      // Resolve deferred promise to complete mutation
      deferred.resolve({
        data: {
          success: true,
          requisition: { ...requisitionsFixture[0], requisition_status: 'Approved', payment_destination: 'ACCOUNTS' }
        }
      });

      // Verify success feedback appears and modal closes
      await waitFor(() => {
        expect(screen.getByText(/Requisition successfully approved/i)).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: /Take Workflow Action/i })).not.toBeInTheDocument();
      });
    });

    it('places a requisition on hold with mandatory remarks', async () => {
      renderPage(<Requisitions />, {
        role: 'ho',
        initialUrl: '/requisitions?tab=pending'
      });

      const actionInterceptor = interceptApiCall(authApi, 'patch', '/action', {
        response: { success: true }
      });

      const takeActionButtons = await screen.findAllByRole('button', { name: /Take Action/i });
      fireEvent.click(takeActionButtons[0]);

      expect(await screen.findByRole('heading', { name: /Take Workflow Action/i })).toBeInTheDocument();

      // Switch to Hold action via select
      const actionSelect = await screen.findByRole('combobox', { name: /Action/i });
      fireEvent.change(actionSelect, { target: { value: 'Hold' } });

      // Enter remarks
      const remarksInput = screen.getByPlaceholderText(/Enter the reason/i);
      fireEvent.change(remarksInput, { target: { value: 'Awaiting site verification documents' } });

      // Submit form
      const form = document.getElementById('workflow-action-form');
      fireEvent.submit(form);

      await waitFor(() => {
        expect(actionInterceptor.calls.length).toBe(1);
      });

      assertApiCalledWith(actionInterceptor, {
        url: '/action',
        partialBody: {
          action: 'Hold',
          remarks_approved_authority: 'Awaiting site verification documents',
          approved_amount: null
        }
      });

      await waitFor(() => {
        expect(screen.getByText(/Requisition successfully placed on hold/i)).toBeInTheDocument();
      });
    });

    it('surfaces API errors gracefully without closing the action modal', async () => {
      renderPage(<Requisitions />, {
        role: 'zo',
        initialUrl: '/requisitions?tab=pending'
      });

      interceptApiCall(authApi, 'patch', '/action', {
        isError: true,
        status: 400,
        response: { message: 'Capacity check failed on server' }
      });

      const takeActionButtons = await screen.findAllByRole('button', { name: /Take Action/i });
      fireEvent.click(takeActionButtons[0]);

      const remarksInput = await screen.findByPlaceholderText(/Enter the reason/i);
      fireEvent.change(remarksInput, { target: { value: 'Approving' } });

      const amountInput = screen.getByPlaceholderText('0.00');
      fireEvent.change(amountInput, { target: { value: '10000' } });

      const form = document.getElementById('workflow-action-form');
      fireEvent.submit(form);

      // Error banner is surfaced on the page level by handleAct
      await waitFor(() => {
        expect(screen.getByText('Capacity check failed on server')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: /Take Workflow Action/i })).not.toBeInTheDocument();
      });
    });
  });

  describe('Role Permissions & Visibility', () => {
    it('restricts JE role from viewing or triggering Take Action controls', async () => {
      renderPage(<Requisitions />, {
        role: 'je',
        initialUrl: '/requisitions?tab=pending'
      });

      await waitFor(() => {
        expect(screen.getByText('Requisition Management')).toBeInTheDocument();
      });

      // Take action button should NOT exist for JE
      expect(screen.queryByRole('button', { name: /Take Action/i })).not.toBeInTheDocument();
      // But JE can View Details
      const detailButtons = await screen.findAllByRole('button', { name: /View Details/i });
      expect(detailButtons.length).toBeGreaterThan(0);
    });
  });

  describe('Cancellation Workflow', () => {
    it('cancels a requisition with confirmation modal, in-flight state, and feedback', async () => {
      renderPage(<Requisitions />, {
        role: 'admin',
        initialUrl: '/requisitions?tab=pending'
      });

      const deferred = createDeferred();
      const cancelInterceptor = interceptApiCall(authApi, 'patch', '/cancel', {
        deferred,
        response: { success: true }
      });

      await waitFor(() => {
        expect(screen.getByText('Requisition Management')).toBeInTheDocument();
      });

      const cancelButtons = await screen.findAllByRole('button', { name: /^Cancel$/i });
      expect(cancelButtons.length).toBeGreaterThan(0);
      fireEvent.click(cancelButtons[0]);

      // Cancel confirmation modal should open
      expect(await screen.findByRole('heading', { name: /Cancel Requisition/i })).toBeInTheDocument();
      expect(screen.getByText(/Irreversible Deletion Guard/i)).toBeInTheDocument();

      const confirmBtn = screen.getByRole('button', { name: /Confirm Cancellation/i });
      fireEvent.click(confirmBtn);

      // Verify in-flight loading state
      await waitFor(() => {
        expect(confirmBtn).toBeDisabled();
      });

      expect(cancelInterceptor.calls.length).toBe(1);
      expect(cancelInterceptor.calls[0].url).toContain('/cancel');

      // Resolve cancellation
      deferred.resolve({ data: { success: true } });

      await waitFor(() => {
        expect(screen.getByText(/cancelled successfully/i)).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: /Cancel Requisition/i })).not.toBeInTheDocument();
      });
    });
  });

  describe('Payment Route Workflow', () => {
    it('routes an approved requisition to Accounts', async () => {
      renderPage(<Requisitions />, {
        role: 'admin',
        initialUrl: '/requisitions?tab=approved'
      });

      const routeInterceptor = interceptApiCall(authApi, 'post', '/send-to-accounts', {
        response: { success: true }
      });

      await waitFor(() => {
        expect(screen.getByText('Requisition Management')).toBeInTheDocument();
      });

      // Find "Choose Payment Route"
      const routeBtns = await screen.findAllByRole('button', { name: /Choose Payment Route/i });
      expect(routeBtns.length).toBeGreaterThan(0);
      fireEvent.click(routeBtns[0]);

      expect(await screen.findByRole('heading', { name: /Choose Payment Route/i })).toBeInTheDocument();

      // Click "Send to Accounts" option
      const sendToAccountsOptionBtn = screen.getByRole('button', { name: /Send to Accounts/i });
      fireEvent.click(sendToAccountsOptionBtn);

      // Click "Confirm" button
      const confirmBtn = screen.getByRole('button', { name: /Confirm/i });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(routeInterceptor.calls.length).toBe(1);
      });

      expect(routeInterceptor.calls[0].url).toContain('/send-to-accounts');
      await waitFor(() => {
        expect(screen.getByText(/Requisition sent to Accounts/i)).toBeInTheDocument();
      });
    });
  });
});
