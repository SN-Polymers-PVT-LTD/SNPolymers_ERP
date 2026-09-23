import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import EstimatedBill from './EstimatedBill';
import {
  renderPage,
  createDeferred,
  interceptApiCall,
  assertApiCalledWith
} from '../test';
import authApi from '../api/authApi';

vi.mock('../api/authApi');

describe('EstimatedBill Workflow Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockWorkOrders = [
    {
      work_order_no: 'WO-101',
      site_details: 'Site A - Pipeline Construction',
      work_order_value: 1000000,
      total_billed: 200000,
      remaining_value: 800000,
      zone: 'North Zone',
      department: 'PHE',
      district: 'Kolkata',
      state: 'West Bengal'
    }
  ];

  it('creates an estimated bill entry with in-flight state, payload assertion, and success popup', async () => {
    renderPage(<EstimatedBill />, {
      role: 'ho',
      initialUrl: '/estimated-bills',
      overrides: {
        '/estimated-bills/work-orders': { success: true, workOrders: mockWorkOrders },
        '/estimated-bills': { success: true, data: [] }
      }
    });

    const deferred = createDeferred();
    const createInterceptor = interceptApiCall(authApi, 'post', '/estimated-bills', {
      deferred,
      response: {
        success: true,
        entry: {
          id: 'est-99',
          work_order_no: 'WO-101',
          estimated_bill_amount: 150000,
          estimated_payment_date: '2026-10-15'
        }
      }
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Estimated Bill Module/i })).toBeInTheDocument();
    });

    // Click "New Estimate"
    const newEstBtn = screen.getByRole('button', { name: /New Estimate/i });
    fireEvent.click(newEstBtn);

    // Modal opens
    expect(await screen.findByRole('heading', { name: /Estimated Bill Entry/i })).toBeInTheDocument();

    // Select Work Order
    const woSelect = screen.getByDisplayValue('Select a Work Order...');
    fireEvent.change(woSelect, { target: { value: 'WO-101' } });

    // Enter Amount
    const amountInput = screen.getByPlaceholderText('0.00');
    fireEvent.change(amountInput, { target: { value: '150000' } });

    // Enter Estimated Date in modal
    const dateInputs = document.querySelectorAll('input[type="date"]');
    const modalDateInput = dateInputs[dateInputs.length - 1];
    expect(modalDateInput).toBeInTheDocument();
    fireEvent.change(modalDateInput, { target: { value: '2026-10-15' } });

    // Click Save Estimate
    const saveBtn = screen.getByRole('button', { name: /Save Estimate/i });
    fireEvent.click(saveBtn);

    // Verify in-flight loading state
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Saving\.\.\./i })).toBeDisabled();
    });

    // Assert API call
    expect(createInterceptor.calls.length).toBe(1);
    assertApiCalledWith(createInterceptor, {
      url: '/estimated-bills',
      partialBody: {
        work_order_no: 'WO-101',
        estimated_bill_amount: 150000,
        estimated_payment_date: '2026-10-15'
      }
    });

    // Resolve deferred
    deferred.resolve({
      data: {
        success: true,
        entry: {
          id: 'est-99',
          work_order_no: 'WO-101',
          estimated_bill_amount: 150000,
          estimated_payment_date: '2026-10-15'
        }
      }
    });

    // Verify success popup
    await waitFor(() => {
      expect(screen.getByText('Estimate Saved')).toBeInTheDocument();
    });
  });

  it('validates remaining capacity and blocks submission if amount exceeds remaining capacity', async () => {
    renderPage(<EstimatedBill />, {
      role: 'ho',
      initialUrl: '/estimated-bills',
      overrides: {
        '/estimated-bills/work-orders': { success: true, workOrders: mockWorkOrders },
        '/estimated-bills': { success: true, data: [] }
      }
    });

    const createInterceptor = interceptApiCall(authApi, 'post', '/estimated-bills', {
      response: { success: true }
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Estimated Bill Module/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /New Estimate/i }));
    await screen.findByRole('heading', { name: /Estimated Bill Entry/i });

    const woSelect = screen.getByDisplayValue('Select a Work Order...');
    fireEvent.change(woSelect, { target: { value: 'WO-101' } });

    // Enter Amount exceeding remaining value (remaining is 800000)
    const amountInput = screen.getByPlaceholderText('0.00');
    fireEvent.change(amountInput, { target: { value: '950000' } });

    // Validation error shown
    await waitFor(() => {
      expect(screen.getByText(/Estimated amount cannot exceed Remaining Work Order Capacity/i)).toBeInTheDocument();
    });

    // Save button disabled
    const saveBtn = screen.getByRole('button', { name: /Save Estimate/i });
    expect(saveBtn).toBeDisabled();

    // API should not be called
    expect(createInterceptor.calls.length).toBe(0);
  });
});
