const safeFilenamePart = (value) => String(value || 'Unknown').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80);
const dateText = (value) => value ? new Date(value).toLocaleString('en-IN') : '';
const amount = (value) => Number(value || 0);

export const filterSubcontractEstimates = (estimates, { selectedFilter, statusFilter, searchQuery }) => {
  const query = searchQuery.trim().toLowerCase();
  return estimates.filter((est) => {
    if (selectedFilter === 'Draft' && est.estimate_status !== 'Draft') return false;
    if (statusFilter !== 'All' && est.estimate_status !== statusFilter) return false;
    if (query && ![
      est.work_order_no,
      est.projects_master?.site_details,
      est.subcontract_estimate_id
    ].some((value) => String(value || '').toLowerCase().includes(query))) return false;
    return true;
  });
};

export async function fetchFilteredSubcontractEstimates(fetchPage, filters) {
  const serverStatus = filters.statusFilter !== 'All'
    ? filters.statusFilter
    : filters.selectedFilter === 'Draft' ? 'Draft' : undefined;
  const params = { page: 1, limit: 100, ...(serverStatus ? { status: serverStatus } : {}) };
  const firstResponse = await fetchPage(params);
  const allEstimates = [...(firstResponse.data?.estimates || [])];
  const totalPages = firstResponse.data?.pagination?.totalPages || 1;
  for (let nextPage = 2; nextPage <= totalPages; nextPage += 1) {
    const response = await fetchPage({ ...params, page: nextPage });
    allEstimates.push(...(response.data?.estimates || []));
  }
  const unique = [...new Map(allEstimates.map((est) => [est.subcontract_estimate_id, est])).values()];
  const expectedTotal = firstResponse.data?.pagination?.totalItems;
  if (Number.isInteger(expectedTotal) && unique.length < expectedTotal) {
    throw new Error('The estimate list changed during export. Please try again.');
  }
  return filterSubcontractEstimates(unique, filters);
}

export async function fetchSubcontractEstimateDetails(estimates, fetchDetail, batchSize = 5) {
  const details = [];
  for (let start = 0; start < estimates.length; start += batchSize) {
    const batch = estimates.slice(start, start + batchSize);
    const responses = await Promise.all(batch.map((estimate) => fetchDetail(estimate.subcontract_estimate_id)));
    details.push(...responses.map((response) => {
      const detail = response.data?.estimate;
      if (!detail) throw new Error('An estimate detail response was empty. Please retry the export.');
      return detail;
    }));
  }
  return details;
}

export async function exportSubcontractEstimatesListToExcel(estimates, filters, detailedEstimates = []) {
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();
  const rows = [
    ['Subcontract Estimates'],
    ['Exported At', dateText(new Date())],
    ['Sheet Filter', filters.selectedFilter],
    ['Status Filter', filters.statusFilter],
    ['Search', filters.searchQuery.trim() || 'All'],
    ['Matching Estimates', estimates.length],
    [],
    ['No.', 'Work Order', 'Site Details', 'Revision', 'Status', 'Estimated Amount (INR)', 'Created At', 'Updated At', 'Estimate ID'],
    ...estimates.map((est, index) => [
      index + 1,
      est.work_order_no || '',
      est.projects_master?.site_details || '',
      Number(est.estimate_revision || 0),
      est.estimate_status || '',
      amount(est.estimate_amount),
      dateText(est.created_at),
      dateText(est.updated_at),
      est.subcontract_estimate_id || ''
    ])
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = [8, 22, 40, 12, 22, 24, 22, 22, 40].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(workbook, sheet, 'Estimates');

  const lineHeaders = [
    'Estimate ID', 'Work Order', 'Estimate Status', 'Estimate Revision',
    'Line No.', 'Line State', 'Subcontractor', 'Work', 'Sub Head', 'Unit',
    'Quantity', 'Rate (INR)', 'Amount (INR)', 'Kind', 'Adjusts Line ID',
    'Rate Reference', 'Line Remarks', 'ZO Decision', 'ZO Remarks',
    'HO Decision', 'HO Remarks', 'Approved Revision', 'Approved At', 'Line ID'
  ];
  const lineRows = detailedEstimates.flatMap((estimate) =>
    (estimate.project_subcontract_estimate_lines || []).map((line, index) => [
      estimate.subcontract_estimate_id || '',
      estimate.work_order_no || '',
      estimate.estimate_status || '',
      Number(estimate.estimate_revision || 0),
      index + 1,
      line.final_approved_revision == null ? 'Current Working' : 'Final Approved',
      line.subcontractor?.subcontractor_name || '',
      line.subcontract_work?.material_details || '',
      line.subcontract_work?.sub_head || '',
      line.subcontract_work?.unit || '',
      amount(line.qty),
      amount(line.rate),
      amount(line.amount),
      line.entry_kind || '',
      line.adjusts_line_id || '',
      line.rate_reference || '',
      line.remarks || '',
      line.zo_office_approve || 'Pending',
      line.zo_remarks || '',
      line.ho_office_approve || 'Pending',
      line.ho_remarks || '',
      line.final_approved_revision ?? '',
      dateText(line.final_approved_at),
      line.line_id || ''
    ])
  );
  const lineSheet = XLSX.utils.aoa_to_sheet([lineHeaders, ...lineRows]);
  lineSheet['!cols'] = lineHeaders.map((header) => ({ wch: Math.max(14, Math.min(header.length + 4, 36)) }));
  XLSX.utils.book_append_sheet(workbook, lineSheet, 'Line Items');
  XLSX.writeFile(workbook, `Subcontract_Estimates_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export async function exportSubcontractEstimateToExcel(estimate) {
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();
  const lines = estimate.project_subcontract_estimate_lines || [];
  const approved = lines.filter((line) => line.final_approved_revision != null);
  const current = lines.filter((line) => line.final_approved_revision == null);

  const summary = XLSX.utils.aoa_to_sheet([
    ['Subcontract Estimate'],
    ['Work Order', estimate.work_order_no || ''],
    ['Estimate ID', estimate.subcontract_estimate_id || ''],
    ['Status', estimate.estimate_status || ''],
    ['Revision', Number(estimate.estimate_revision || 0)],
    ['Projected Total (INR)', amount(estimate.estimate_amount)],
    ['Approved Baseline (INR)', approved.reduce((sum, line) => sum + amount(line.amount), 0)],
    ['Current Working Delta (INR)', current.reduce((sum, line) => sum + amount(line.amount), 0)],
    ['Created By', estimate.created_by || ''],
    ['Created At', dateText(estimate.created_at)],
    ['Updated At', dateText(estimate.updated_at)],
    ['JE Remarks', estimate.je_remarks || ''],
    ['ZO Remarks', estimate.zo_remarks || ''],
    ['HO Remarks', estimate.ho_remarks || '']
  ]);
  summary['!cols'] = [{ wch: 30 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(workbook, summary, 'Summary');

  const lineHeaders = ['No.', 'Line State', 'Subcontractor', 'Work', 'Sub Head', 'Unit', 'Quantity', 'Rate (INR)', 'Amount (INR)', 'Kind', 'Adjusts Line ID', 'Rate Reference', 'Line Remarks', 'ZO Decision', 'ZO Remarks', 'HO Decision', 'HO Remarks', 'Approved Revision', 'Approved At', 'Line ID'];
  const lineRows = lines.map((line, index) => [
    index + 1,
    line.final_approved_revision == null ? 'Current Working' : 'Final Approved',
    line.subcontractor?.subcontractor_name || '',
    line.subcontract_work?.material_details || '',
    line.subcontract_work?.sub_head || '',
    line.subcontract_work?.unit || '',
    amount(line.qty),
    amount(line.rate),
    amount(line.amount),
    line.entry_kind || '',
    line.adjusts_line_id || '',
    line.rate_reference || '',
    line.remarks || '',
    line.zo_office_approve || 'Pending',
    line.zo_remarks || '',
    line.ho_office_approve || 'Pending',
    line.ho_remarks || '',
    line.final_approved_revision ?? '',
    dateText(line.final_approved_at),
    line.line_id || ''
  ]);
  const lineSheet = XLSX.utils.aoa_to_sheet([lineHeaders, ...lineRows]);
  lineSheet['!cols'] = lineHeaders.map((header) => ({ wch: Math.max(14, Math.min(header.length + 4, 36)) }));
  XLSX.utils.book_append_sheet(workbook, lineSheet, 'Line Items');

  const workflowHeaders = ['When', 'Action', 'From Status', 'To Status', 'Actor', 'Actor Role', 'Remarks'];
  const workflowRows = (estimate.project_subcontract_estimate_workflow_log || []).map((event) => [
    dateText(event.created_at), event.action || '', event.from_status || '', event.to_status || '',
    event.actor_user?.display_name || event.actor || '', event.actor_role || '', event.remarks || ''
  ]);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([workflowHeaders, ...workflowRows]), 'Workflow History');

  const revisionHeaders = ['Cycle', 'Stage', 'Requested By', 'Initiated At', 'Deadline', 'Resubmitted By', 'Resubmitted At'];
  const revisionRows = (estimate.subcontract_estimate_revision_log || []).map((rev) => [
    rev.revision_cycle ?? '', rev.stage || '', rev.requested_by || '', dateText(rev.created_at),
    dateText(rev.revision_deadline), rev.resubmitted_by || '', dateText(rev.resubmitted_at)
  ]);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([revisionHeaders, ...revisionRows]), 'Revision Cycles');

  XLSX.writeFile(workbook, `Subcontract_Estimate_${safeFilenamePart(estimate.work_order_no)}_Rev_${Number(estimate.estimate_revision || 0)}.xlsx`);
}
