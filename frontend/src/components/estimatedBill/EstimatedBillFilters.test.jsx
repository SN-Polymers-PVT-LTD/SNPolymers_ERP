import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import EstimatedBillFilters from './EstimatedBillFilters';

describe('EstimatedBillFilters Component Tests', () => {
  const initialFilters = {
    zone: '',
    work_order_no: '',
    status: '',
    min_surety: '',
    payment_date_from: '',
    payment_date_to: ''
  };

  const workOrders = [
    { work_order_no: 'WO-WB_KOL_01', department: 'PHE', site_details: 'Kolkata Site' }
  ];

  it('renders filter form controls', () => {
    render(
      <EstimatedBillFilters
        filters={initialFilters}
        onFilterChange={() => {}}
        userRole="ho"
        workOrders={workOrders}
      />
    );

    expect(screen.getByText('Zone')).toBeInTheDocument();
    expect(screen.getByText('Work Order')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Min. Surety %')).toBeInTheDocument();
    expect(screen.getByText('From Date')).toBeInTheDocument();
    expect(screen.getByText('To Date')).toBeInTheDocument();
  });

  it('calls onFilterChange when a filter select changes', () => {
    const handleFilterChange = vi.fn();
    render(
      <EstimatedBillFilters
        filters={initialFilters}
        onFilterChange={handleFilterChange}
        userRole="ho"
        workOrders={workOrders}
      />
    );

    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'Kolkata Zone' } });

    expect(handleFilterChange).toHaveBeenCalledWith(expect.objectContaining({
      zone: 'Kolkata Zone'
    }));
  });

  it('renders Clear Filters button when filters are active and clears filters on click', () => {
    const handleFilterChange = vi.fn();
    const activeFilters = { ...initialFilters, zone: 'Kolkata Zone' };

    render(
      <EstimatedBillFilters
        filters={activeFilters}
        onFilterChange={handleFilterChange}
        userRole="ho"
        workOrders={workOrders}
      />
    );

    const clearBtn = screen.getByRole('button', { name: /clear filters/i });
    expect(clearBtn).toBeInTheDocument();

    fireEvent.click(clearBtn);
    expect(handleFilterChange).toHaveBeenCalledWith(initialFilters);
  });
});
