import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import TimelineProgress from './TimelineProgress';

describe('TimelineProgress accurate status tracking', () => {
  it('renders Draft active state when status is Draft', () => {
    render(<TimelineProgress status="Draft" request={{ request_status: 'Draft' }} />);
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('Submitted')).toBeInTheDocument();
    expect(screen.getByText('Accounts Review')).toBeInTheDocument();
    expect(screen.getByText('HO Review')).toBeInTheDocument();
  });

  it('renders Accounts Queue when Pending and not yet imported', () => {
    render(
      <TimelineProgress
        status="Pending"
        request={{
          request_status: 'Pending',
          accounts_line_item_id: null
        }}
      />
    );
    expect(screen.getByText('Accounts Queue')).toBeInTheDocument();
    expect(screen.getByText('Awaiting import')).toBeInTheDocument();
    expect(screen.getByText('HO Review')).toBeInTheDocument();
  });

  it('renders In Accounts Sheet when imported', () => {
    render(
      <TimelineProgress
        status="Pending"
        request={{
          request_status: 'Pending',
          accounts_line_item_id: 'f24f3436-8fae-4905-a410-1a45fdf8f7a8',
          accounts_imported_at: '2026-09-19T13:31:35.590Z'
        }}
      />
    );
    expect(screen.getByText('In Accounts Sheet')).toBeInTheDocument();
    expect(screen.getByText(/Imported/i)).toBeInTheDocument();
    expect(screen.getByText('HO Review')).toBeInTheDocument();
  });

  it('renders On Hold outcome accurately with pause indicator', () => {
    render(
      <TimelineProgress
        status="Hold"
        request={{
          request_status: 'Hold',
          accounts_line_item_id: 'f24f3436-8fae-4905-a410-1a45fdf8f7a8',
          ho_remarks: 'wait'
        }}
      />
    );
    expect(screen.getByText('In Accounts Sheet')).toBeInTheDocument();
    expect(screen.getByText('On Hold')).toBeInTheDocument();
    expect(screen.getByText('Paused')).toBeInTheDocument();
  });

  it('renders Returned outcome accurately', () => {
    render(
      <TimelineProgress
        status="Returned"
        request={{
          request_status: 'Returned',
          accounts_line_item_id: 'f24f3436-8fae-4905-a410-1a45fdf8f7a8',
          ho_remarks: 'Fix account number'
        }}
      />
    );
    expect(screen.getByText('Returned')).toBeInTheDocument();
    expect(screen.getByText('For correction')).toBeInTheDocument();
  });

  it('renders Rejected outcome accurately', () => {
    render(
      <TimelineProgress
        status="Rejected"
        request={{
          request_status: 'Rejected',
          accounts_line_item_id: 'f24f3436-8fae-4905-a410-1a45fdf8f7a8'
        }}
      />
    );
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.getByText('Declined')).toBeInTheDocument();
  });

  it('renders Dismissed state when accounts_import_dismissed is true', () => {
    render(
      <TimelineProgress
        status="Pending"
        request={{
          request_status: 'Pending',
          accounts_import_dismissed: true
        }}
      />
    );
    expect(screen.getByText('Accounts Dismissed')).toBeInTheDocument();
    expect(screen.getByText('Dismissed')).toBeInTheDocument();
  });
});
