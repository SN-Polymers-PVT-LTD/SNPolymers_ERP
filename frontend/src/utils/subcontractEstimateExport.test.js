import { describe, expect, it, vi } from 'vitest';
import { exportSubcontractEstimateToExcel, fetchFilteredSubcontractEstimates, filterSubcontractEstimates } from './subcontractEstimateExport';
import * as XLSX from 'xlsx';

vi.mock('xlsx', () => ({
  utils: {
    book_new: vi.fn(() => ({ SheetNames: [], Sheets: {} })),
    aoa_to_sheet: vi.fn((rows) => ({ rows })),
    book_append_sheet: vi.fn((workbook, sheet, name) => {
      workbook.SheetNames.push(name);
      workbook.Sheets[name] = sheet;
    })
  },
  writeFile: vi.fn()
}));

const filters = {
  selectedFilter: 'All',
  statusFilter: 'All',
  searchQuery: ''
};

describe('subcontract estimate export selection', () => {
  it('uses the same status and search filters as the visible list while retaining completed estimates', () => {
    const rows = [
      { subcontract_estimate_id: '1', work_order_no: 'WO-1', estimate_status: 'Submitted', projects_master: { site_details: 'North' } },
      { subcontract_estimate_id: '2', work_order_no: 'WO-2', estimate_status: 'Final Approved', projects_master: { site_details: 'South' } },
      { subcontract_estimate_id: '3', work_order_no: 'WO-3', estimate_status: 'Draft', projects_master: { site_details: 'North' } }
    ];
    expect(filterSubcontractEstimates(rows, { ...filters, searchQuery: 'north' }).map((row) => row.subcontract_estimate_id)).toEqual(['1', '3']);
    expect(filterSubcontractEstimates(rows, filters).map((row) => row.subcontract_estimate_id)).toEqual(['1', '2', '3']);
    expect(filterSubcontractEstimates(rows, { ...filters, selectedFilter: 'Draft', statusFilter: 'Submitted' })).toEqual([]);
  });

  it('fetches every authorized page, applies filters, and removes a duplicate at a page boundary', async () => {
    const fetchPage = vi.fn(async ({ page }) => ({
      data: {
        pagination: { totalPages: 2 },
        estimates: page === 1
          ? [
              { subcontract_estimate_id: '1', work_order_no: 'WO-1', estimate_status: 'Submitted' },
              { subcontract_estimate_id: '2', work_order_no: 'WO-2', estimate_status: 'Draft' }
            ]
          : [
              { subcontract_estimate_id: '2', work_order_no: 'WO-2', estimate_status: 'Draft' },
              { subcontract_estimate_id: '3', work_order_no: 'WO-3', estimate_status: 'Draft' }
            ]
      }
    }));

    const selected = await fetchFilteredSubcontractEstimates(fetchPage, { ...filters, selectedFilter: 'Draft' });
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage).toHaveBeenNthCalledWith(1, { page: 1, limit: 100, status: 'Draft' });
    expect(fetchPage).toHaveBeenNthCalledWith(2, { page: 2, limit: 100, status: 'Draft' });
    expect(selected.map((row) => row.subcontract_estimate_id)).toEqual(['2', '3']);
  });

  it('does not silently export an incomplete list after page contents shift', async () => {
    const fetchPage = vi.fn(async ({ page }) => ({
      data: {
        pagination: { totalPages: 2, totalItems: 3 },
        estimates: page === 1
          ? [{ subcontract_estimate_id: '1', estimate_status: 'Draft' }, { subcontract_estimate_id: '2', estimate_status: 'Draft' }]
          : [{ subcontract_estimate_id: '2', estimate_status: 'Draft' }]
      }
    }));
    await expect(fetchFilteredSubcontractEstimates(fetchPage, filters)).rejects.toThrow('list changed during export');
  });

  it('exports current and approved lines with decisions and audit sheets', async () => {
    await exportSubcontractEstimateToExcel({
      subcontract_estimate_id: 'estimate-1',
      work_order_no: 'WO/1',
      estimate_status: 'Estimate Reopened',
      estimate_revision: 2,
      estimate_amount: 1250,
      project_subcontract_estimate_lines: [
        { line_id: 'approved', amount: '1000', qty: '2', rate: '500', final_approved_revision: 1, entry_kind: 'BASE', zo_office_approve: 'Approve', ho_office_approve: 'Approve' },
        { line_id: 'current', amount: '250', qty: '1', rate: '250', final_approved_revision: null, entry_kind: 'ADDITION', zo_office_approve: null, ho_office_approve: null }
      ],
      project_subcontract_estimate_workflow_log: [{ action: 'REOPEN', from_status: 'Final Approved', to_status: 'Estimate Reopened' }],
      subcontract_estimate_revision_log: [{ revision_cycle: 2, stage: 'ZO' }]
    });

    const [workbook, filename] = vi.mocked(XLSX.writeFile).mock.lastCall;
    expect(workbook.SheetNames).toEqual(['Summary', 'Line Items', 'Workflow History', 'Revision Cycles']);
    expect(workbook.Sheets.Summary.rows).toContainEqual(['Approved Baseline (INR)', 1000]);
    expect(workbook.Sheets.Summary.rows).toContainEqual(['Current Working Delta (INR)', 250]);
    expect(workbook.Sheets['Line Items'].rows[1][1]).toBe('Final Approved');
    expect(workbook.Sheets['Line Items'].rows[2][1]).toBe('Current Working');
    expect(workbook.Sheets['Line Items'].rows[2][13]).toBe('Pending');
    expect(filename).toBe('Subcontract_Estimate_WO_1_Rev_2.xlsx');
  });
});
