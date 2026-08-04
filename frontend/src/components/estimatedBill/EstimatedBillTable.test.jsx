import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import EstimatedBillTable from './EstimatedBillTable';

describe('EstimatedBillTable Component Tests', () => {
  const sampleData = [
    {
      id: 1,
      work_order_no: 'WO-WB_KOL_01',
      zone: 'Kolkata Zone',
      department: 'PHE',
      work_order_value: 500000,
      estimated_bill_amount: 350000,
      surety_pct: 85,
      updated_by_name: 'Shreyan Ghosh',
      entry_count: 1
    },
    {
      id: 2,
      work_order_no: 'WO-WB_SLG_02',
      zone: 'North Bengal',
      department: 'PWD',
      work_order_value: 800000,
      estimated_bill_amount: 600000,
      surety_pct: 60,
      updated_by_name: 'John Doe',
      entry_count: 2
    }
  ];

  it('renders skeleton loader when isLoading is true', () => {
    const { container } = render(<EstimatedBillTable data={[]} isLoading={true} />);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders empty state message when data is empty', () => {
    render(<EstimatedBillTable data={[]} isLoading={false} />);
    expect(screen.getByText(/No Estimated Bills Recorded/i)).toBeInTheDocument();
  });

  it('renders table rows and badges correctly when data is provided', () => {
    render(<EstimatedBillTable data={sampleData} isLoading={false} />);
    expect(screen.getByText('WO-WB_KOL_01')).toBeInTheDocument();
    expect(screen.getByText('WO-WB_SLG_02')).toBeInTheDocument();
    expect(screen.getByText('85%')).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument();
  });

  it('triggers onViewLedgerClick callback when View Ledger button is clicked', () => {
    const handleViewLedger = vi.fn();
    render(<EstimatedBillTable data={sampleData} isLoading={false} onViewLedgerClick={handleViewLedger} />);
    
    const viewLedgerButtons = screen.getAllByRole('button', { name: /view ledger/i });
    fireEvent.click(viewLedgerButtons[0]);
    
    expect(handleViewLedger).toHaveBeenCalledWith('WO-WB_KOL_01');
  });
});
