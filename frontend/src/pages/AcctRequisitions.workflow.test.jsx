import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import AcctRequisitions from './AcctRequisitions';
import {
  renderPage,
  createDeferred,
  interceptApiCall,
  assertApiCalledWith
} from '../test';
import { acctSheetDetailFixture } from '../test/fixtures/domainFixtures';
import authApi from '../api/authApi';

vi.mock('../api/authApi');

describe('AcctRequisitions Workflow Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Create Sheet Workflow', () => {
    it('creates a new sheet with deferred in-flight state and navigates to the created sheet', async () => {
      const { readLocation } = renderPage(<AcctRequisitions />, {
        role: 'accounts',
        initialUrl: '/acct-requisitions'
      });

      const deferred = createDeferred();
      const createInterceptor = interceptApiCall(authApi, 'post', '/acct-requisitions/sheets', {
        deferred,
        response: {
          success: true,
          sheet: {
            id: 'sheet-new-99',
            sheet_number: 'SHEET-2026-99',
            sheet_status: 'Open'
          }
        }
      });

      // Wait for page to render
      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1, name: /Requisition Sheets/i })).toBeInTheDocument();
      });

      const newSheetBtn = screen.getByRole('button', { name: /New Sheet/i });
      fireEvent.click(newSheetBtn);

      // Verify in-flight loading state
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /New Sheet/i })).toBeDisabled();
      });

      // Assert intercepted API call
      expect(createInterceptor.calls.length).toBe(1);
      assertApiCalledWith(createInterceptor, {
        url: '/acct-requisitions/sheets',
        partialBody: {}
      });

      // Resolve deferred
      deferred.resolve({
        data: {
          success: true,
          sheet: {
            id: 'sheet-new-99',
            sheet_number: 'SHEET-2026-99',
            sheet_status: 'Open'
          }
        }
      });

      // Verify navigation to new sheet detail URL
      await waitFor(() => {
        expect(readLocation()).toBe('/acct-requisitions/sheets/sheet-new-99');
      }, { timeout: 3000 });
    });

    it('surfaces error banner when create sheet fails and stays on list view', async () => {
      const { readLocation } = renderPage(<AcctRequisitions />, {
        role: 'accounts',
        initialUrl: '/acct-requisitions'
      });

      interceptApiCall(authApi, 'post', '/acct-requisitions/sheets', {
        isError: true,
        status: 500,
        response: { message: 'Database conflict creating requisition sheet' }
      });

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1, name: /Requisition Sheets/i })).toBeInTheDocument();
      });

      const newSheetBtn = screen.getByRole('button', { name: /New Sheet/i });
      fireEvent.click(newSheetBtn);

      // Error banner surfaced
      await waitFor(() => {
        expect(screen.getByText('Database conflict creating requisition sheet')).toBeInTheDocument();
      });

      // URL remains unchanged
      expect(readLocation()).toBe('/acct-requisitions');
    });
  });

  describe('Discard Empty Sheet Workflow', () => {
    it('discards an open empty sheet with in-flight state and success feedback', async () => {
      const openSheet = {
        id: 'sheet-open-empty',
        sheet_number: 'SHEET-EMPTY-01',
        sheet_status: 'Open',
        item_count: 0,
        total_amount: 0,
        created_at: '2026-09-21T00:00:00Z'
      };

      renderPage(<AcctRequisitions />, {
        role: 'accounts',
        initialUrl: '/acct-requisitions',
        overrides: {
          '/acct-requisitions/sheets': {
            success: true,
            sheets: [openSheet],
            pagination: { page: 1, limit: 20, total: 1, totalPages: 1 }
          }
        }
      });

      const deferred = createDeferred();
      const deleteInterceptor = interceptApiCall(authApi, 'delete', (url) => url.includes('/acct-requisitions/sheets/'), {
        deferred,
        response: {
          success: true,
          deleted: true,
          restoredImportCount: 0
        }
      });

      // Find discard button on row
      const discardBtn = await screen.findByRole('button', { name: /Discard/i });
      expect(discardBtn).toBeInTheDocument();

      fireEvent.click(discardBtn);

      // Verify in-flight disabled state
      await waitFor(() => {
        expect(discardBtn).toBeDisabled();
      });

      expect(deleteInterceptor.calls.length).toBe(1);
      expect(deleteInterceptor.calls[0].url).toContain('sheet-open-empty');

      deferred.resolve({
        data: {
          success: true,
          deleted: true,
          restoredImportCount: 0
        }
      });

      // Verify success feedback
      await waitFor(() => {
        expect(screen.getByText('Sheet discarded.')).toBeInTheDocument();
      });
    });
  });

  describe('Role Authorization', () => {
    it('denies access to non-accounts roles (e.g. je)', async () => {
      renderPage(<AcctRequisitions />, {
        role: 'je',
        initialUrl: '/acct-requisitions'
      });

      expect(screen.getByText('Access denied.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /New Sheet/i })).not.toBeInTheDocument();
    });
  });
});
