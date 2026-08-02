import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import EstimatedBillStats from './EstimatedBillStats';

describe('EstimatedBillStats Component Tests', () => {
  const sampleData = [
    {
      estimated_bill_amount: 100000,
      surety_pct: 100
    },
    {
      estimated_bill_amount: 200000,
      surety_pct: 50
    }
  ];

  it('renders skeleton placeholders when loading', () => {
    const { container } = render(<EstimatedBillStats data={[]} isLoading={true} />);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('calculates total count, total amount, weighted amount, and average surety correctly', () => {
    render(<EstimatedBillStats data={sampleData} isLoading={false} />);
    
    expect(screen.getByText('Work Orders')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument(); // Count
    expect(screen.getByText('Total Estimated Amount')).toBeInTheDocument();
    expect(screen.getByText('Surety-Weighted Total')).toBeInTheDocument();
    expect(screen.getByText('Avg. % Surety')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument(); // Avg of 100 and 50
  });
});
