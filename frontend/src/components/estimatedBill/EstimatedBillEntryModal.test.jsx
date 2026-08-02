import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import EstimatedBillEntryModal from './EstimatedBillEntryModal';

vi.mock('../AuthContext', () => ({
  useAuth: () => ({ user: { display_name: 'Shreyan Ghosh', role: 'ho' } })
}));

vi.mock('../../api/estimatedBillsApi', () => ({
  getEstimatedBillByWO: vi.fn().mockResolvedValue({ data: { success: false } })
}));

describe('EstimatedBillEntryModal Component Tests', () => {
  const workOrderOptions = [
    { work_order_no: 'WO-WB_KOL_01', work_order_value: 500000, zone: 'Kolkata Zone', department: 'PHE', district: 'Kolkata', state: 'West Bengal', site_details: 'Site A' }
  ];

  it('does not render when isOpen is false', () => {
    render(
      <EstimatedBillEntryModal
        isOpen={false}
        onClose={() => {}}
        workOrderOptions={workOrderOptions}
        onSave={() => {}}
      />
    );

    expect(screen.queryByText('Estimated Bill Entry')).not.toBeInTheDocument();
  });

  it('renders modal title and form controls when isOpen is true', () => {
    render(
      <EstimatedBillEntryModal
        isOpen={true}
        onClose={() => {}}
        workOrderOptions={workOrderOptions}
        onSave={() => {}}
      />
    );

    expect(screen.getByText('Estimated Bill Entry')).toBeInTheDocument();
    expect(screen.getAllByText(/Work Order/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Save Estimate/i)).toBeInTheDocument();
  });

  it('validates missing Work Order on submit', async () => {
    render(
      <EstimatedBillEntryModal
        isOpen={true}
        onClose={() => {}}
        workOrderOptions={workOrderOptions}
        onSave={() => {}}
      />
    );

    const saveBtn = screen.getByRole('button', { name: /save estimate/i });
    fireEvent.click(saveBtn);

    expect(screen.getByText(/Please select a Work Order/i)).toBeInTheDocument();
  });
});
