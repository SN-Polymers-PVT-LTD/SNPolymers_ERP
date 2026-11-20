import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import PayrollBlockers, { formatBlockerTitle } from './PayrollBlockers';

describe('PayrollBlockers', () => {
  it('formats known and unknown blocker codes into clean human-readable text', () => {
    expect(formatBlockerTitle('LEAVE_CALENDAR_ENTITLEMENT_REQUIRED')).toBe(
      'Published holiday/leave calendar entry required'
    );
    expect(formatBlockerTitle('COMPLETE_GROSS_REQUIRED')).toBe(
      'Complete gross calculation required before deductions'
    );
    expect(formatBlockerTitle('UNKNOWN_CUSTOM_BLOCKER_CODE')).toBe(
      'Unknown Custom Blocker Code'
    );
  });

  it('renders blocker items with human-readable labels, date range pills and diagnostic breakdown', () => {
    const blockers = [
      { code: 'LEAVE_CALENDAR_ENTITLEMENT_REQUIRED', date: '2026-08-08' },
      { code: 'LEAVE_CALENDAR_ENTITLEMENT_REQUIRED', date: '2026-08-31' },
      { code: 'COMPLETE_GROSS_REQUIRED' }
    ];

    render(<PayrollBlockers blockers={blockers} />);

    // Shows human-readable labels in the main list
    const mainList = screen.getByRole('list');
    expect(
      within(mainList).getByText('Published holiday/leave calendar entry required')
    ).toBeInTheDocument();
    expect(
      within(mainList).getByText('Complete gross calculation required before deductions')
    ).toBeInTheDocument();

    // Shows the affected date range
    expect(screen.getByText('2 affected dates')).toBeInTheDocument();
    expect(screen.getByText('(2026-08-08 → 2026-08-31)')).toBeInTheDocument();

    // Diagnostic breakdown contains collapsible summary and raw codes for audit
    expect(
      screen.getByText('Daily diagnostic details (3)')
    ).toBeInTheDocument();
    expect(screen.getAllByText('LEAVE_CALENDAR_ENTITLEMENT_REQUIRED')).toHaveLength(2);
    expect(screen.getByText('COMPLETE_GROSS_REQUIRED')).toBeInTheDocument();
  });

  it('renders cleanly when blockers array is empty', () => {
    const { container } = render(<PayrollBlockers blockers={[]} />);
    expect(container.querySelectorAll('li')).toHaveLength(0);
    expect(screen.queryByText(/Daily diagnostic details/)).not.toBeInTheDocument();
  });
});
