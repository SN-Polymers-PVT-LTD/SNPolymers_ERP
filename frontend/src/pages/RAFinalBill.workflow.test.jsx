import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import RAFinalBill from './RAFinalBill';
import {
  renderPage,
  createDeferred,
  interceptApiCall,
  assertApiCalledWith
} from '../test';
import { projectsFixture, raBillsFixture } from '../test/fixtures/domainFixtures';
import authApi from '../api/authApi';

vi.mock('../api/authApi');

describe('RAFinalBill Workflow Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockBillSummary = {
    work_order_value: 1000000,
    estimate_amount: 1000000,
    billing_cap: 1000000,
    billing_remaining: 500000,
    previous_bill_amount: 500000,
    dropdown_options: [
      { value: 'RA Bill', label: 'RA Bill (Run)', available: true },
      { value: 'Final Bill', label: 'Final Bill (Closure)', available: true }
    ]
  };

  it('creates an RA bill entry with in-flight state, payload assertion, and success toast', async () => {
    renderPage(<RAFinalBill />, {
      role: 'zo',
      initialUrl: '/ra-final-bills?modal=create&create_wo=WO-101',
      overrides: {
        '/ra-final-bills/summary/WO-101': { success: true, ...mockBillSummary },
        '/ra-final-bills': { success: true, bills: raBillsFixture, totalCount: 1 }
      }
    });

    const deferred = createDeferred();
    const createInterceptor = interceptApiCall(authApi, 'post', '/ra-final-bills', {
      deferred,
      response: {
        success: true,
        bill: {
          bill_id: 'bill-new-99',
          bill_no: 'RA-099',
          gross_bill: 200000
        }
      }
    });

    // Wait for create modal to load
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: /RA \/ Final Bill Entry/i })).toBeInTheDocument();
    });

    // Select Type of Payment
    const paymentTypeSelect = screen.getByLabelText(/Type of Payment/i);
    fireEvent.change(paymentTypeSelect, { target: { value: 'RA Bill' } });

    // Enter Bill Date (today's date)
    const now = new Date();
    const todayStr = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0')
    ].join('-');
    const dateInputs = document.querySelectorAll('input[type="date"]');
    const billDateInput = dateInputs[dateInputs.length - 1];
    fireEvent.change(billDateInput, { target: { value: todayStr } });

    // Enter Bill No
    const billNoInput = screen.getByPlaceholderText('Enter Bill No');
    fireEvent.change(billNoInput, { target: { value: 'RA-099' } });

    // Enter Gross Bill
    const grossBillInput = screen.getByPlaceholderText('Enter Gross Bill Amount');
    fireEvent.change(grossBillInput, { target: { value: '200000' } });

    // Upload bill copy
    interceptApiCall(authApi, 'post', '/ra-final-bills/upload/bill-copy', {
      response: { success: true, bill_copy_url: 'https://storage/bill.pdf', original_filename: 'bill.pdf' }
    });
    const file = new File(['dummy content'], 'bill.pdf', { type: 'application/pdf' });
    const fileInput = document.getElementById('bill-copy-upload-input');
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByText(/Uploaded Successfully/i)).toBeInTheDocument();
    });

    // Click Save Bill
    const saveBtn = screen.getByRole('button', { name: /Save Bill/i });
    fireEvent.click(saveBtn);

    // Verify in-flight loading state
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Saving\.\.\./i })).toBeDisabled();
    });

    expect(createInterceptor.calls.length).toBe(1);
    assertApiCalledWith(createInterceptor, {
      url: '/ra-final-bills',
      partialBody: {
        work_order_no: 'WO-101',
        payment_type: 'RA Bill',
        bill_no: 'RA-099',
        gross_bill: 200000
      }
    });

    deferred.resolve({
      data: {
        success: true,
        bill: {
          bill_id: 'bill-new-99',
          bill_no: 'RA-099',
          gross_bill: 200000
        }
      }
    });

    // Verify success toast
    await waitFor(() => {
      expect(screen.getByText('Bill entry saved successfully!')).toBeInTheDocument();
    });
  });

  it('validates against overbilling cap and displays error without calling API', async () => {
    renderPage(<RAFinalBill />, {
      role: 'zo',
      initialUrl: '/ra-final-bills?modal=create&create_wo=WO-101',
      overrides: {
        '/ra-final-bills/summary/WO-101': { success: true, ...mockBillSummary },
        '/ra-final-bills': { success: true, bills: raBillsFixture, totalCount: 1 }
      }
    });

    const createInterceptor = interceptApiCall(authApi, 'post', '/ra-final-bills', {
      response: { success: true }
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: /RA \/ Final Bill Entry/i })).toBeInTheDocument();
    });

    const paymentTypeSelect = screen.getByLabelText(/Type of Payment/i);
    fireEvent.change(paymentTypeSelect, { target: { value: 'RA Bill' } });

    const now = new Date();
    const todayStr = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0')
    ].join('-');
    const dateInputs = document.querySelectorAll('input[type="date"]');
    const billDateInput = dateInputs[dateInputs.length - 1];
    fireEvent.change(billDateInput, { target: { value: todayStr } });
    fireEvent.change(screen.getByPlaceholderText('Enter Bill No'), { target: { value: 'RA-OVER' } });

    // Upload file
    interceptApiCall(authApi, 'post', '/ra-final-bills/upload/bill-copy', {
      response: { success: true, bill_copy_url: 'https://storage/bill.pdf', original_filename: 'bill.pdf' }
    });
    const file = new File(['dummy content'], 'bill.pdf', { type: 'application/pdf' });
    const fileInput = document.getElementById('bill-copy-upload-input');
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByText(/Uploaded Successfully/i)).toBeInTheDocument();
    });

    // Enter Gross Bill exceeding remaining cap (remaining is 500,000, enter 600,000)
    const grossBillInput = screen.getByPlaceholderText('Enter Gross Bill Amount');
    fireEvent.change(grossBillInput, { target: { value: '600000' } });

    const saveBtn = screen.getByRole('button', { name: /Save Bill/i });
    fireEvent.click(saveBtn);

    // Overbilling error surfaced
    await waitFor(() => {
      expect(screen.getByText(/This bill would cause overbilling/i)).toBeInTheDocument();
    });

    // API never called
    expect(createInterceptor.calls.length).toBe(0);
  });
});
