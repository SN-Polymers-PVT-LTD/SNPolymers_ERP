import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import ExcessFundReturns from './ExcessFundReturns';
import {
  renderPage,
  createDeferred,
  interceptApiCall,
  assertApiCalledWith
} from '../test';
import authApi from '../api/authApi';

vi.mock('../api/authApi');

describe('ExcessFundReturns Workflows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('admin/ho: opens request modal, validates inputs, shows in-flight state, submits payload, and closes modal', async () => {
    const { readLocation } = renderPage(<ExcessFundReturns />, {
      role: 'admin',
      initialUrl: '/excess-fund-returns',
      overrides: {
        targetZOs: [
          {
            mobile_number: '+919876543212',
            display_name: 'Western Zone Office',
            full_name: 'Western Zone Office',
            zo_user_id: '+919876543212',
            available_balance: 750000
          }
        ],
        excessFundReturns: []
      }
    });

    const deferredPost = createDeferred();
    const postInterceptor = interceptApiCall(authApi, 'post', '/excess-fund-returns', { deferred: deferredPost });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Excess Fund Returns/i })).toBeInTheDocument();
    });

    // Open Request Return Modal
    const requestBtn = screen.getByRole('button', { name: /Request Fund Return/i });
    fireEvent.click(requestBtn);

    await waitFor(() => {
      expect(screen.getByText('Request Excess Fund Return')).toBeInTheDocument();
    });

    // Select target ZO
    const zoSelect = screen.getByRole('combobox');
    fireEvent.change(zoSelect, { target: { value: '+919876543212' } });

    // Enter return amount
    const amountInput = screen.getByPlaceholderText('0.00');
    fireEvent.change(amountInput, { target: { value: '50000' } });

    // Enter remarks
    const remarksInput = screen.getByPlaceholderText(/Provide instructions on returning excess funds/i);
    fireEvent.change(remarksInput, { target: { value: 'Surplus refund requested for FY26' } });

    // Submit form
    const submitBtn = screen.getByRole('button', { name: /Request Return/i });
    expect(submitBtn).not.toBeDisabled();
    const form = submitBtn.closest('form');
    fireEvent.submit(form);

    // Verify in-flight loading state
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Submitting\.\.\./i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Submitting\.\.\./i })).toBeDisabled();
    });

    // Resolve deferred
    deferredPost.resolve({
      data: {
        success: true,
        message: 'Excess fund return request successfully sent to Zonal Office.'
      }
    });

    // Verify success feedback and API call payload
    await waitFor(() => {
      expect(screen.getByText(/Excess fund return request successfully sent to Zonal Office\./i)).toBeInTheDocument();
    });

    expect(postInterceptor.calls.length).toBe(1);
    assertApiCalledWith(postInterceptor, {
      url: '/excess-fund-returns',
      body: {
        zo_user_id: '+919876543212',
        requested_amount: 50000,
        remarks_ho: 'Surplus refund requested for FY26'
      }
    });

    // Modal should be closed
    await waitFor(() => {
      expect(screen.queryByText('Request Excess Fund Return')).not.toBeInTheDocument();
      expect(new URLSearchParams(readLocation().split('?')[1] || '').has('modal')).toBe(false);
    }, { timeout: 5000 });
  });

  it('zo: opens evaluation drawer, fills work order breakdown allocations, verifies in-flight state, and accepts return', async () => {
    const pendingReturn = {
      id: 'efr-100',
      return_request_id: 'efr-100',
      zo_user_id: '+919876543212',
      zo_name: 'Western Zone Office',
      work_order_no: 'WO-101',
      requested_amount: 100000,
      status: 'Requested',
      remarks_ho: 'Excess buffer return requested',
      created_at: '2026-08-25T10:00:00Z',
      updated_at: '2026-08-25T10:00:00Z'
    };

    renderPage(<ExcessFundReturns />, {
      role: 'zo',
      user: {
        role: 'zo',
        mobile_number: '+919876543212',
        display_name: 'Western Zone Office'
      },
      initialUrl: '/excess-fund-returns',
      overrides: {
        excessFundReturns: [pendingReturn],
        zonalBalances: [
          {
            zo_user_id: '+919876543212',
            full_name: 'Western Zone Office',
            available_balance: 500000,
            work_order_no: 'WO-101'
          }
        ],
        projects: [
          {
            work_order_no: 'WO-101',
            project_name: 'Substation Expansion',
            zo_user_id: '+919876543212',
            status: 'Active'
          }
        ]
      }
    });

    const deferredAccept = createDeferred();
    const acceptInterceptor = interceptApiCall(authApi, 'post', '/excess-fund-returns/efr-100/accept', { deferred: deferredAccept });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Excess Fund Returns/i })).toBeInTheDocument();
    });

    interceptApiCall(authApi, 'get', '/projects', {
      response: {
        success: true,
        projects: [
          {
            work_order_no: 'WO-101',
            project_name: 'Substation Expansion',
            zo_user_id: '+919876543212',
            status: 'Running'
          }
        ]
      }
    });

    interceptApiCall(authApi, 'get', '/zo-balances', {
      response: {
        success: true,
        balances: [
          {
            zo_user_id: '+919876543212',
            work_order_no: 'WO-101',
            available_balance: 500000
          }
        ]
      }
    });

    // Click "Evaluate" button
    const evaluateBtn = await screen.findByRole('button', { name: /Evaluate/i });
    fireEvent.click(evaluateBtn);

    // Modal should be open and the breakdown input for WO-101 should appear
    await waitFor(() => {
      expect(screen.getByText('Evaluate Return Request')).toBeInTheDocument();
    });

    const breakdownInput = await screen.findByPlaceholderText('0.00');

    // "Accept Return" button should initially be disabled because allocated total is 0 != 100000
    const acceptBtn = screen.getByRole('button', { name: /Accept Return/i });
    expect(acceptBtn).toBeDisabled();

    // Fill allocation for WO-101
    fireEvent.change(breakdownInput, { target: { value: '100000' } });

    // Now accept button should be enabled
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Accept Return/i })).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole('button', { name: /Accept Return/i }));

    // Verify in-flight loading state
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Processing\.\.\./i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Processing\.\.\./i })).toBeDisabled();
    });

    // Resolve deferred
    deferredAccept.resolve({
      data: {
        success: true,
        message: 'Fund return accepted. Balance updated and logged in ledger.'
      }
    });

    // Verify success feedback
    await waitFor(() => {
      expect(screen.getByText(/Fund return accepted\. Balance updated and logged in ledger\./i)).toBeInTheDocument();
    });

    expect(acceptInterceptor.calls.length).toBe(1);
    assertApiCalledWith(acceptInterceptor, {
      url: '/excess-fund-returns/efr-100/accept',
      body: {
        client_updated_at: '2026-08-25T10:00:00Z',
        breakdown: [{ work_order_no: 'WO-101', amount: 100000 }]
      }
    });

    // Modal should be closed
    await waitFor(() => expect(screen.queryByText('Evaluate Return Request')).not.toBeInTheDocument(), { timeout: 5000 });
  });

  it('zo: enforces mandatory remarks before rejecting and sends PATCH /reject with remarks', async () => {
    const pendingReturn = {
      id: 'efr-101',
      return_request_id: 'efr-101',
      zo_user_id: '+919876543212',
      zo_name: 'Western Zone Office',
      work_order_no: 'WO-101',
      requested_amount: 75000,
      status: 'Requested',
      remarks_ho: 'Partial return needed',
      created_at: '2026-08-25T10:00:00Z',
      updated_at: '2026-08-25T10:00:00Z'
    };

    renderPage(<ExcessFundReturns />, {
      role: 'zo',
      user: {
        role: 'zo',
        mobile_number: '+919876543212',
        display_name: 'Western Zone Office'
      },
      initialUrl: '/excess-fund-returns',
      overrides: {
        excessFundReturns: [pendingReturn],
        zonalBalances: [
          {
            zo_user_id: '+919876543212',
            full_name: 'Western Zone Office',
            available_balance: 500000,
            work_order_no: 'WO-101'
          }
        ],
        projects: [
          {
            work_order_no: 'WO-101',
            project_name: 'Substation Expansion',
            zo_user_id: '+919876543212',
            status: 'Active'
          }
        ]
      }
    });

    const deferredReject = createDeferred();
    const rejectInterceptor = interceptApiCall(authApi, 'patch', '/excess-fund-returns/efr-101/reject', { deferred: deferredReject });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Excess Fund Returns/i })).toBeInTheDocument();
    });

    const evaluateBtn = await screen.findByRole('button', { name: /Evaluate/i });
    fireEvent.click(evaluateBtn);

    await waitFor(() => {
      expect(screen.getByText('Evaluate Return Request')).toBeInTheDocument();
    });

    // Reject button must be disabled when remarks are empty
    const rejectBtn = screen.getByRole('button', { name: /^Reject$/i });
    expect(rejectBtn).toBeDisabled();

    // Type remarks
    const remarksTextarea = screen.getByPlaceholderText(/Required for modifications or rejections/i);
    fireEvent.change(remarksTextarea, {
      target: { value: 'Funds committed to imminent supplier delivery milestone' }
    });

    // Now Reject button should be enabled
    expect(rejectBtn).not.toBeDisabled();
    fireEvent.click(rejectBtn);

    // Verify in-flight loading state
    await waitFor(() => {
      expect(rejectBtn).toBeDisabled();
    });

    // Resolve deferred reject
    deferredReject.resolve({
      data: {
        success: true,
        message: 'Return request successfully rejected.'
      }
    });

    // Verify success feedback
    await waitFor(() => {
      expect(screen.getByText(/Return request successfully rejected\./i)).toBeInTheDocument();
    });

    expect(rejectInterceptor.calls.length).toBe(1);
    assertApiCalledWith(rejectInterceptor, {
      url: '/excess-fund-returns/efr-101/reject',
      body: {
        remarks_zo: 'Funds committed to imminent supplier delivery milestone'
      }
    });

    // Modal closes
    await waitFor(() => expect(screen.queryByText('Evaluate Return Request')).not.toBeInTheDocument(), { timeout: 5000 });
  });
});
