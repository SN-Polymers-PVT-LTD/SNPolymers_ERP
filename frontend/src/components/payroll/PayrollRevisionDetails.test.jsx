import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import PayrollRevisionDetails from './PayrollRevisionDetails';

describe('readable payroll revision details', () => {
  it('shows saved rates and references without exposing internal identifiers or engine configuration', () => {
    const { container } = render(<PayrollRevisionDetails revision={{ id: 'internal-secret-id', scheme: 'EPF', establishment: 'Fabric Factory', effective_from: '2026-08-01', configuration: { employee_rate: '0', employer_rate: '12', wage_ceiling: '15000.00', calculation_method: 'CAPPED_WAGE_PERCENTAGE' }, approval_reference: 'UAT approval' }} />);
    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(screen.getByText('12%')).toBeInTheDocument();
    expect(screen.getByText('₹15000.00')).toBeInTheDocument();
    expect(screen.getByText('Ongoing')).toBeInTheDocument();
    expect(screen.getByText('UAT approval')).toBeInTheDocument();
    expect(container).not.toHaveTextContent('internal-secret-id');
    expect(container).not.toHaveTextContent('CAPPED_WAGE_PERCENTAGE');
    expect(container.querySelector('pre')).toBeNull();
  });
  it('does not invent standard contribution rates when they are absent', () => {
    render(<PayrollRevisionDetails revision={{ scheme: 'ESI', configuration: {} }} />);
    expect(screen.queryByText('Employee contribution')).not.toBeInTheDocument();
    expect(screen.queryByText('3.25%')).not.toBeInTheDocument();
  });
  it('shows previous values and a readable professional tax table with zero deductions', () => {
    render(<PayrollRevisionDetails before={{ configuration: { employee_rate: '10' } }} revision={{ scheme: 'PT', configuration: { employee_rate: '12' }, slabs: [{ month: 8, lower_bound: '0', upper_bound: null, deduction_amount: '0' }] }} />);
    expect(screen.getByText('Previously: 10%')).toBeInTheDocument();
    expect(screen.getByText('August')).toBeInTheDocument();
    expect(screen.getByText('No upper limit')).toBeInTheDocument();
    expect(screen.getAllByText('₹0')).toHaveLength(2);
  });
});
