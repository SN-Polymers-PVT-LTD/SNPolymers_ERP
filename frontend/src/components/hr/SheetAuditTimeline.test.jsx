import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SheetAuditTimeline from './SheetAuditTimeline';

describe('SheetAuditTimeline component', () => {
  it('renders default empty message when events array is empty', () => {
    render(<SheetAuditTimeline events={[]} />);
    expect(screen.getByText('No history for this sheet.')).toBeInTheDocument();
  });

  it('renders loading status message', () => {
    render(<SheetAuditTimeline events={[]} loading={true} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading history…');
  });

  it('renders error alert with retry button', () => {
    const onRetry = vi.fn();
    render(<SheetAuditTimeline events={[]} error="Failed to fetch history" onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to fetch history');
    fireEvent.click(screen.getByRole('button', { name: 'Retry History' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders event nodes with action badge, timestamp, actor avatar, and combined text', () => {
    const events = [
      {
        id: 'evt-1',
        action: 'SHEET_SUBMITTED',
        user_name: 'Factory Operator',
        timestamp: '2026-09-30T12:00:00Z'
      },
      {
        id: 'evt-2',
        action: 'RETURN',
        user_name: 'HO Reviewer',
        timestamp: '2026-09-30T13:30:00Z'
      }
    ];

    render(<SheetAuditTimeline events={events} />);

    // Preserves exact text match for regression queries: SHEET_SUBMITTED · Factory Operator
    expect(screen.getByText(/SHEET_SUBMITTED · Factory Operator/)).toBeInTheDocument();
    expect(screen.getByText(/RETURN · HO Reviewer/)).toBeInTheDocument();

    // Initials avatar
    expect(screen.getByText('FO')).toBeInTheDocument();
    expect(screen.getByText('HR')).toBeInTheDocument();
  });

  it('renders pagination when totalPages > 1 and handles page clicks', () => {
    const onPageChange = vi.fn();
    const events = [
      { id: 'evt-1', action: 'SAVE', user_name: 'User One', timestamp: '2026-09-30T12:00:00Z' }
    ];
    const pagination = {
      currentPage: 1,
      totalPages: 3,
      totalItems: 45,
      onPageChange
    };

    render(<SheetAuditTimeline events={events} pagination={pagination} />);
    expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });
  it('preserves precise audit timestamps and displays changed decision/return remarks', () => {
    const timestamp='2026-09-30T12:00:13.123Z';
    render(<SheetAuditTimeline events={[{id:'event',action:'SHEET_RETURNED',user_name:'Reviewer',timestamp,
      old_value:{return_remarks:'Earlier return'},new_value:{return_remarks:'Correct exit timestamp',decision_remarks:'Reject unsupported leave'}}]} />);
    const time=screen.getByText('30 Sept 2026, 17:30:13 IST');
    expect(time).toHaveAttribute('datetime',timestamp);expect(time).toHaveAttribute('title',timestamp);
    expect(screen.getByText('Correct exit timestamp')).toBeInTheDocument();
    expect(screen.getByText('Reject unsupported leave')).toBeInTheDocument();
  });

});
