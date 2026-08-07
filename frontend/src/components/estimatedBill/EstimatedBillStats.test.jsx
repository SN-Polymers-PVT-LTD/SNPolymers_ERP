import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import EstimatedBillStats from './EstimatedBillStats';

describe('EstimatedBillStats Component Tests', () => {
  const sampleData = [
    {
      total_billed: 80000,
      remaining_value: 120000,
      surety_pct: 100
    },
    {
      total_billed: 50000,
      remaining_value: 150000,
      surety_pct: 50
    }
  ];

  it('renders skeleton placeholders when loading', () => {
    const { container } = render(<EstimatedBillStats data={[]} isLoading={true} />);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('calculates work order count, billed total, remaining capacity, and average surety correctly', () => {
    render(<EstimatedBillStats data={sampleData} isLoading={false} />);

    expect(screen.getByText('Work Orders')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Total RA Billed')).toBeInTheDocument();
    expect(screen.getByText('Remaining Capacity')).toBeInTheDocument();
    expect(screen.getByText('Avg. % Surety')).toBeInTheDocument();
    expect(screen.getByText('₹1,30,000')).toBeInTheDocument(); // 80000 + 50000
    expect(screen.getByText('₹2,70,000')).toBeInTheDocument(); // 120000 + 150000
    expect(screen.getByText('75%')).toBeInTheDocument(); // Avg of 100 and 50
  });
});
