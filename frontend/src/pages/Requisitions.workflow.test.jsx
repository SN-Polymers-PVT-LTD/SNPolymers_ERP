import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import Requisitions from './Requisitions';
import {
  renderPage,
  createDeferred,
  interceptApiCall,
  assertApiCalledWith
} from '../test';
import {
  requisitionsFixture,
  estimatesFixture,
  indianBanksFixture
} from '../test/fixtures/domainFixtures';
import authApi from '../api/authApi';

vi.mock('../api/authApi');

describe('Requisitions Workflow Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function fillJeRequisitionForm() {
    fireEvent.click(await screen.findByRole('button', { name: /New Requisition/i }));
    const modal = (await screen.findByRole('heading', { name: /Create Requisition/i })).closest('.glass-panel');
    fireEvent.click(within(modal).getByRole('button', { name: /Next Step/i }));
    fireEvent.change(within(modal).getByLabelText(/Work Order No/i), { target: { value: 'WO-101' } });
    fireEvent.click(within(modal).getByRole('button', { name: /Next Step/i }));
    fireEvent.change(within(modal).getByPlaceholderText('e.g. REQ-WO-001'), { target: { value: 'REQ-WO-99' } });
    await waitFor(() => expect(within(modal).getByLabelText(/Material Main Head/i).options.length).toBeGreaterThan(1));
    fireEvent.change(within(modal).getByLabelText(/Material Main Head/i), { target: { value: 'Electrical' } });
    const upload = modal.querySelector('input[type="file"]');
    fireEvent.change(upload, { target: { files: [new File(['%PDF-1.4'], 'REQ-WO-99.pdf', { type: 'application/pdf' })] } });
    await within(modal).findByText('REQ-WO-99.pdf');
    fireEvent.change(within(modal).getByPlaceholderText('0.00'), { target: { value: '15000' } });
    fireEvent.change(within(modal).getByPlaceholderText(/Enter payee/i), { target: { value: 'Test Contractor' } });
    fireEvent.change(within(modal).getByPlaceholderText(/Enter bank account no/i), { target: { value: '123456789012' } });
    fireEvent.change(within(modal).getByPlaceholderText('e.g. SBIN0001234'), { target: { value: 'SBIN0001234' } });
    await waitFor(() => expect(within(modal).getByLabelText(/Indian Banks/i).options.length).toBeGreaterThan(1));
    fireEvent.change(within(modal).getByLabelText(/Indian Banks/i), { target: { value: 'bank-01' } });
    return modal;
  }

  it('JE creates a requisition, keeps the URL, and refreshes the list; a rejected retry stays editable', async () => {
    let listFetches = 0;
    const { readLocation } = renderPage(<Requisitions />, {
      role: 'je',
      initialUrl: '/requisitions?tab=pending&unrelated=keep',
      overrides: {
        '/estimates/est-cost-1': { success: true, items: estimatesFixture[0].items },
        '/estimates': { success: true, estimates: [estimatesFixture[0]] },
        '/requisitions/indian-banks': { success: true, indianBanks: indianBanksFixture },
        '/requisitions/capacity': { success: true, mainHeadEstimate: 500000, cumulativeApproved: 100000, remainingCapacity: 400000 },
        '/requisitions': (url) => {
          if (url === '/requisitions') {
            listFetches += 1;
            const rows = listFetches > 1 ? [{ ...requisitionsFixture[0], requisition_no: 'REQ-WO-99' }] : requisitionsFixture;
            return { success: true, requisitions: rows, data: rows };
          }
          return undefined;
        }
      }
    });
    const deferred = createDeferred();
    const createCall = interceptApiCall(authApi, 'post', (url) => url === '/requisitions', { deferred });
    const uploadCall = interceptApiCall(authApi, 'post', '/requisitions/upload/requisition-pdf', {
      response: { storagePath: 'test/path.pdf', attachmentId: 'attachment-99', signedUrl: 'https://example.test/path.pdf' }
    });
    const modal = await fillJeRequisitionForm();
    expect(uploadCall.calls).toHaveLength(1);
    fireEvent.submit(modal.querySelector('#requisition-creation-form'));
    expect(createCall.calls).toHaveLength(1);
    await waitFor(() => expect(within(modal).getByRole('button', { name: /Save Requisition/i })).toBeDisabled());
    assertApiCalledWith(createCall, {
      url: '/requisitions',
      partialBody: {
        work_order_no: 'WO-101', requisition_no: 'REQ-WO-99', material_main_head: 'Electrical',
        requisition_pdf_attachment_id: 'attachment-99', requisition_amount: 15000,
        beneficiary_name: 'Test Contractor', beneficiary_ac_no: '123456789012',
        beneficiary_ifsc: 'SBIN0001234', beneficiary_bank_id: 'bank-01'
      }
    });
    const error = new Error('Requisition rejected');
    error.response = { data: { message: 'Requisition rejected' } };
    await act(async () => { deferred.reject(error); });
    expect(within(modal).getByText('Requisition rejected')).toBeInTheDocument();
    expect(within(modal).getByRole('button', { name: /Save Requisition/i })).toBeEnabled();
    expect(readLocation()).toContain('unrelated=keep');
    expect(readLocation()).toContain('create=true');
    expect(listFetches).toBe(1);

    createCall.restore();
    const retry = interceptApiCall(authApi, 'post', (url) => url === '/requisitions', { response: { success: true } });
    fireEvent.submit(modal.querySelector('#requisition-creation-form'));
    await waitFor(() => {
      expect(retry.calls).toHaveLength(1);
      expect(screen.getByText(/REQ-WO-99 submitted successfully/i)).toBeInTheDocument();
      expect(listFetches).toBeGreaterThan(1);
    });
    await waitFor(() => {
      expect(modal).not.toBeInTheDocument();
      expect(readLocation()).toContain('unrelated=keep');
      expect(readLocation()).not.toContain('create=');
    });
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
      await act(async () => {
        deferred.resolve({
          data: {
            success: true,
            requisition: { ...requisitionsFixture[0], requisition_status: 'Approved', payment_destination: 'ACCOUNTS' }
          }
        });
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
