import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
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

  async function fillEstimateForm() {
    fireEvent.click(screen.getByRole('button', { name: /New Estimate/i }));
    await screen.findByRole('heading', { name: /Estimated Bill Entry/i });
    fireEvent.change(screen.getByDisplayValue('Select a Work Order...'), { target: { value: 'WO-101' } });
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '150000' } });
    const modalDateInput = [...document.querySelectorAll('input[type="date"]')].at(-1);
    fireEvent.change(modalDateInput, { target: { value: '2026-10-15' } });
  }

  it('creates an estimated bill entry with in-flight state, payload assertion, and success popup', async () => {
    let listFetches = 0;
    const { readLocation } = renderPage(<EstimatedBill />, {
      role: 'ho',
      initialUrl: '/estimated-bills?zone=North&unrelated=keep',
      overrides: {
        '/estimated-bills/work-orders': { success: true, workOrders: mockWorkOrders },
        '/estimated-bills': () => {
          listFetches += 1;
          return { success: true, data: listFetches > 1 ? [{ ...mockWorkOrders[0], estimated_bill_amount: 150000, surety_pct: 80, entry_count: 1 }] : [] };
        }
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

    await fillEstimateForm();

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
      expect(listFetches).toBeGreaterThan(1);
      expect(screen.getByText('WO-101')).toBeInTheDocument();
      expect(readLocation()).toContain('unrelated=keep');
      expect(readLocation()).not.toContain('modal=');
    });
  });

  it('shows server errors without discarding input or navigating away', async () => {
    let listFetches = 0;
    const { readLocation } = renderPage(<EstimatedBill />, {
      role: 'ho',
      initialUrl: '/estimated-bills?unrelated=keep',
      overrides: {
        '/estimated-bills/work-orders': { success: true, workOrders: mockWorkOrders },
        '/estimated-bills': () => { listFetches += 1; return { success: true, data: [] }; }
      }
    });
    const deferred = createDeferred();
    interceptApiCall(authApi, 'post', '/estimated-bills', { deferred });
    await screen.findByRole('heading', { name: /Estimated Bill Module/i });
    await fillEstimateForm();
    fireEvent.click(screen.getByRole('button', { name: /Save Estimate/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Saving/i })).toBeDisabled());
    const error = new Error('Forecast save failed');
    error.response = { data: { message: 'Forecast save failed' } };
    await act(async () => { deferred.reject(error); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Forecast save failed');
    expect(screen.getByPlaceholderText('0.00')).toHaveValue('1,50,000');
    expect(screen.getByRole('button', { name: /Save Estimate/i })).toBeEnabled();
    expect(screen.queryByText('Estimate Saved')).not.toBeInTheDocument();
    expect(readLocation()).toContain('unrelated=keep');
    expect(readLocation()).toContain('modal=new');
    expect(listFetches).toBe(1);
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
