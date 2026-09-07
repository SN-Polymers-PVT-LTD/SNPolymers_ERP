export async function exportToExcel(estimate, items) {
  if (!estimate || !items || items.length === 0) {
    alert('No items to export.');
    return;
  }

  const XLSX = await import('xlsx');

  // Format line items
  const formattedRows = items.map((item, index) => ({
    "Sl. No.": index + 1,
    "Work Order No.": estimate.work_order_no || '',
    "Estimate No.": estimate.estimate_no || '',
    "Area Code": estimate.area_code || '',
    "Estimate Status": estimate.estimate_status || '',
    "Main Head": item.material_main_head || '',
    "Sub Head": item.material_sub_head || '',
    "Material Details": item.material_details || '',
    "Unit": item.unit || '',
    "Quantity": item.qty || 0,
    "Rate (INR)": item.rate || 0,
    "Amount (INR)": item.amount || 0,
    "ZO Approve Status": item.zo_office_approve || 'Pending',
    "ZO Remarks": item.zo_remarks || '',
    "HO Approve Status": item.ho_office_approve || 'Pending',
    "HO Remarks": item.ho_remarks || '',
    "Source of Purchase": item.purchase_data?.name || item.source_of_purchase || 'N/A'
  }));

  // Create worksheet and workbook
  const worksheet = XLSX.utils.json_to_sheet(formattedRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Line Items");

  // Save workbook
  const filename = `Estimate_${estimate.estimate_no || 'Draft'}_Rev_${estimate.estimate_revision || 0}.xlsx`;
  XLSX.writeFile(workbook, filename);
}

export async function exportToPDF(elementId, estimateNo) {
  const element = document.getElementById(elementId);
  if (!element) {
    alert('Print area element not found.');
    return;
  }

  const html2pdfModule = await import('html2pdf.js');
  const html2pdf = html2pdfModule.default || html2pdfModule;

  const options = {
    margin: [10, 10, 10, 10],
    filename: `Estimate_${estimateNo || 'Draft'}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  html2pdf().set(options).from(element).save();
}

export async function exportMaterialsToExcel(materials) {
  if (!materials || materials.length === 0) {
    alert('No materials to export.');
    return;
  }

  const XLSX = await import('xlsx');

  const formattedRows = materials.map((m, index) => ({
    "Sl. No.": index + 1,
    "Main Head": m.Material_Main_Head || '',
    "Sub Head": m.Material_Sub_Head || '',
    "Material Details": m.Material_Details || '',
    "Unit": m.M_Unit || '',
    "Status": m.is_active ? 'Active' : 'Inactive'
  }));

  const worksheet = XLSX.utils.json_to_sheet(formattedRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Material Master");

  XLSX.writeFile(workbook, `Material_Master_${new Date().toISOString().split('T')[0]}.xlsx`);
}

export async function exportBeneficiariesToExcel(beneficiaries) {
  if (!beneficiaries || beneficiaries.length === 0) {
    alert('No beneficiaries to export.');
    return;
  }

  const XLSX = await import('xlsx');

  const formattedRows = beneficiaries.map((b, index) => ({
    "Sl. No.": index + 1,
    "Account Number": b.account_number || '',
    "IFSC": b.ifsc || '',
    "Beneficiary Name": b.beneficiary_name || '',
    "Bank": b.beneficiary_bank_name || '',
    "Last Used": b.last_used_at ? new Date(b.last_used_at).toLocaleDateString('en-IN') : '',
    "Created": b.created_at ? new Date(b.created_at).toLocaleDateString('en-IN') : ''
  }));

  const worksheet = XLSX.utils.json_to_sheet(formattedRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Beneficiary Master");

  XLSX.writeFile(workbook, `Beneficiary_Master_${new Date().toISOString().split('T')[0]}.xlsx`);
}

export async function exportProjectsToExcel(projects) {
  if (!projects || projects.length === 0) {
    alert('No projects to export.');
    return;
  }

  const XLSX = await import('xlsx');

  const formattedRows = projects.map((p, index) => ({
    "Sl. No.": index + 1,
    "Work Order No.": p.work_order_no || '',
    "Estimate No.": p.estimate_no || '',
    "Work Order Value (INR)": p.work_order_value || 0,
    "EMD Amount (INR)": p.earnest_money_deposit || 0,
    "Site Details": p.site_details || '',
    "State": p.state || '',
    "District": p.district || '',
    "Zone": p.zone || '',
    "Assigned ZO": p.zo_user?.display_name || p.zo_user_id || '',
    "Department": p.department || '',
    "Status": p.status || '',
    "Latitude": p.site_latitude || '',
    "Longitude": p.site_longitude || '',
    "Start Date": p.project_start_date || '',
    "End Date": p.project_end_date || ''
  }));

  const worksheet = XLSX.utils.json_to_sheet(formattedRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Projects Master");

  XLSX.writeFile(workbook, `Projects_Master_${new Date().toISOString().split('T')[0]}.xlsx`);
}

export async function exportFundRequestsToExcel(requests, dateRange) {
  let list = [...requests];

  if (dateRange) {
    const { start, end } = dateRange;
    if (start) {
      const startDate = new Date(start);
      startDate.setHours(0, 0, 0, 0);
      list = list.filter(r => {
        const d = new Date(r.approve_ho_date || r.zo_date || r.created_at);
        return d >= startDate;
      });
    }
    if (end) {
      const endDate = new Date(end);
      endDate.setHours(23, 59, 59, 999);
      list = list.filter(r => {
        const d = new Date(r.approve_ho_date || r.zo_date || r.created_at);
        return d <= endDate;
      });
    }
  }

  if (list.length === 0) {
    alert('No requests found within the selected date range.');
    return;
  }

  const XLSX = await import('xlsx');

  const formattedRows = list.map((r, index) => ({
    "Sl. No.": index + 1,
    "Fund Request No.": r.zo_fr_no || '',
    "Requested Amount (INR)": r.zo_fr_amount || 0,
    "Approved Amount (INR)": r.approve_ho_amount || 0,
    "Request Date": r.zo_date ? new Date(r.zo_date).toLocaleDateString('en-IN') : '',
    "Approved Date": r.approve_ho_date ? new Date(r.approve_ho_date).toLocaleDateString('en-IN') : 'N/A',
    "Requester": r.zo_user_id || '',
    "Status": r.request_status || '',
    "Requester Remarks": r.zo_remarks || '',
    "Authority Remarks": r.remarks_approved_authority || '',
    "Created At": r.created_at ? new Date(r.created_at).toLocaleString('en-IN') : ''
  }));

  const worksheet = XLSX.utils.json_to_sheet(formattedRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Fund Requests");

  XLSX.writeFile(workbook, `Fund_Requests_${new Date().toISOString().split('T')[0]}.xlsx`);
}

export async function exportAuditLogToExcel(logs) {
  if (!logs || logs.length === 0) {
    alert('No audit logs to export.');
    return;
  }

  const XLSX = await import('xlsx');

  const formattedRows = logs.map((log, index) => ({
    "Sl. No.": index + 1,
    "Timestamp": log.timestamp ? new Date(log.timestamp).toLocaleString('en-IN') : '',
    "User ID (Mobile)": log.user_id || '',
    "User Name": log.user_name || 'N/A',
    "Action": log.action || '',
    "Module": log.module_name || '',
    "Record Identifier": log.record_identifier || '',
    "Old Value": log.old_value ? JSON.stringify(log.old_value) : '',
    "New Value": log.new_value ? JSON.stringify(log.new_value) : ''
  }));
  const worksheet = XLSX.utils.json_to_sheet(formattedRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Audit Logs");
  XLSX.writeFile(workbook, `Audit_Logs_${new Date().toISOString().split('T')[0]}.xlsx`);
}

export async function exportArchiveToZip(estimate, items, quotations) {
  if (!estimate || !items || items.length === 0) {
    alert('No items to export.');
    return;
  }

  const JSZip = (await import('jszip')).default;
  const XLSX = await import('xlsx');
  const zip = new JSZip();

  // Format line items
  const formattedRows = items.map((item, index) => ({
    "Sl. No.": index + 1,
    "Work Order No.": estimate.work_order_no || '',
    "Estimate No.": estimate.estimate_no || '',
    "Area Code": estimate.area_code || '',
    "Estimate Status": estimate.estimate_status || '',
    "Main Head": item.material_main_head || '',
    "Sub Head": item.material_sub_head || '',
    "Material Details": item.material_details || '',
    "Unit": item.unit || '',
    "Quantity": item.qty || 0,
    "Rate (INR)": item.rate || 0,
    "Amount (INR)": item.amount || 0,
    "ZO Approve Status": item.zo_office_approve || 'Pending',
    "ZO Remarks": item.zo_remarks || '',
    "HO Approve Status": item.ho_office_approve || 'Pending',
    "HO Remarks": item.ho_remarks || '',
    "Source of Purchase": item.purchase_data?.name || item.source_of_purchase || 'N/A'
  }));

  // Create worksheet and workbook
  const worksheet = XLSX.utils.json_to_sheet(formattedRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Line Items");

  // Write workbook to buffer
  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const baseFilename = `Estimate_${estimate.estimate_no || 'Draft'}_Rev_${estimate.estimate_revision || 0}`;
  
  // Add Excel to ZIP
  zip.file(`${baseFilename}.xlsx`, excelBuffer);

  // Fetch and Add active PDF Quotations
  for (const q of quotations) {
    if (!q.is_deleted && q.quotation_signed_url) {
      try {
        const response = await fetch(q.quotation_signed_url);
        if (!response.ok) throw new Error(`HTTP error ${response.status}`);
        const pdfBlob = await response.blob();
        zip.file(q.original_filename, pdfBlob);
      } catch (err) {
        console.error(`Failed to fetch quotation PDF: ${q.original_filename}`, err);
      }
    }
  }

  // Generate ZIP and download
  const content = await zip.generateAsync({ type: 'blob' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(content);
  link.download = `${baseFilename}_Archive.zip`;
  link.click();
}

import { isFinanciallyActiveRequisition } from './requisitionUtils';

export async function exportSubcontractorRequisitionsToExcel(requisitions, metadata = {}) {
  if (!requisitions || requisitions.length === 0) {
    alert('No requisitions to export.');
    return;
  }

  const XLSX = await import('xlsx');

  const totalActive = requisitions.filter(r => isFinanciallyActiveRequisition(r.requisition_status)).length;
  const totalInactive = requisitions.length - totalActive;

  const headerRows = [
    ["Subcontractor Requisitions Report — SN Polymers"],
    ["Generated At (IST):", new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })],
    ["Work Order Filter:", metadata.workOrderFilter || 'All'],
    ["Search Filter:", metadata.searchFilter || 'None'],
    ["Date Basis:", metadata.dateBasis === 'approved' ? 'Approval Date' : 'Creation Date'],
    ["Date Range:", (metadata.dateFrom || 'Start') + ' to ' + (metadata.dateTo || 'End')],
    ["Total Records:", requisitions.length, "Active Records:", totalActive, "Cancelled / Rejected:", totalInactive],
    []
  ];

  const tableHeaders = [
    "Sl. No.",
    "Subcontractor",
    "Sub Head",
    "Work Order No.",
    "Requisition No.",
    "Status",
    "Requested Amount (INR)",
    "Approved Amount (INR)",
    "Effective Liability (INR)",
    "Requested By",
    "Approved By",
    "Creation Date",
    "Approved On"
  ];

  const dataRows = requisitions.map((r, index) => {
    const reqAmt = Number(r.requisition_amount || 0);
    const appAmt = Number(r.approved_amount || 0);
    // Numeric Effective Liability: Approved requisitions represent confirmed liabilities; cancelled/rejected represent 0.00
    const effectiveLiability = r.requisition_status === 'Approved' ? appAmt : 0.00;

    return [
      index + 1,
      r.material_details || '',
      r.material_sub_head || '',
      r.work_order_no || '',
      r.requisition_no || '',
      r.requisition_status || '',
      reqAmt,
      appAmt,
      effectiveLiability,
      r.requester_name || r.requester_user_id || '',
      r.approved_name || r.approved_user_id || '',
      r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN') : '',
      r.payment_date ? new Date(r.payment_date).toLocaleDateString('en-IN') : ''
    ];
  });

  const worksheet = XLSX.utils.aoa_to_sheet([...headerRows, tableHeaders, ...dataRows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Subcontractor Requisitions");

  XLSX.writeFile(workbook, `Subcontractor_Requisitions_${new Date().toISOString().split('T')[0]}.xlsx`);
}

export async function exportSubcontractorBalancesToExcel(balances, metadata = {}) {
  if (!balances || balances.length === 0) {
    alert('No subcontractor balances to export.');
    return;
  }

  const XLSX = await import('xlsx');

  const headerRows = [
    ["Subcontractor Balances Summary — SN Polymers"],
    ["Generated At (IST):", new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })],
    ["Work Order Filter:", metadata.workOrderFilter || 'All'],
    ["Search Filter:", metadata.searchFilter || 'None'],
    ["Total Subcontractors:", balances.length],
    []
  ];

  const tableHeaders = [
    "Sl. No.",
    "Work Order No.",
    "Department",
    "Site Details",
    "Subcontractor",
    "Sub Head",
    "Estimated Total (INR)",
    "Paid So Far (INR)",
    "Remaining Balance (INR)",
    "Utilization (%)"
  ];

  const dataRows = balances.map((b, index) => {
    const est = Number(b.estimated_total || 0);
    const paid = Number(b.paid_total || 0);
    const rem = Number(b.available_balance || 0);
    const util = est > 0 ? ((paid / est) * 100).toFixed(1) + '%' : '0.0%';

    return [
      index + 1,
      b.work_order_no || '',
      b.project?.department || '',
      b.project?.site_details || '',
      b.material_details || '',
      b.material_sub_head || '',
      est,
      paid,
      rem,
      util
    ];
  });

  const worksheet = XLSX.utils.aoa_to_sheet([...headerRows, tableHeaders, ...dataRows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Subcontractor Balances");

  XLSX.writeFile(workbook, `Subcontractor_Balances_${new Date().toISOString().split('T')[0]}.xlsx`);
}

export async function exportRequisitionDetailsToExcel(items) {
  if (!items || items.length === 0) {
    alert('No requisition details to export.');
    return;
  }

  const XLSX = await import('xlsx');

  const formattedRows = items.map((item, index) => ({
    "Sl. No.": index + 1,
    "Sheet Number": item.sheet_number || '',
    "Date": item.created_at ? new Date(item.created_at).toLocaleDateString('en-IN') : '',
    "Account Sub-title": item.account_sub_title_text || '',
    "Particulars": item.particulars || '',
    "Beneficiary A/c No.": item.beneficiary_ac_no || '',
    "Beneficiary Name": item.beneficiary_name || '',
    "Beneficiary IFSC": item.beneficiary_ifsc || '',
    "Beneficiary Bank": item.beneficiary_bank_name || '',
    "Debit Bank Account": item.debit_bank_ac_type || '',
    "WO. No.": item.work_order_no || '',
    "Req. Amount (INR)": item.req_amount || 0,
    "Payment Mode": item.payment_mode || '',
    "Remarks": item.remarks || '',
    "Requisition Status": item.requisition_status || '',
    "HO Pass Amount (INR)": item.ho_pass_amount || 0,
    "HO Remarks": item.ho_remarks || ''
  }));

  const worksheet = XLSX.utils.json_to_sheet(formattedRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Requisition Details");

  XLSX.writeFile(workbook, `Requisition_Details_${new Date().toISOString().split('T')[0]}.xlsx`);
}

const TX_TYPE_LABELS = {
  ESTIMATE_ITEM_APPROVAL: 'Credit (Estimate Item Approval)',
  ESTIMATE_ITEM_REVERSAL: 'Reversal (Estimate Rejected)',
  REQUISITION_APPROVAL: 'Debit (Requisition Approval)',
  ADMIN_ADJUSTMENT: 'Admin Balance Adjustment'
};

/**
 * Exports a comprehensive statement of account (Ledger) for a specific Subcontractor.
 * Includes:
 *  - Sheet 1: "Ledger Statement" with metadata header, chronological transactions,
 *    document references (e.g. Requisition No), Credit (+), Debit (-), and Running Balance.
 *  - Sheet 2: "Requisitions Breakdown" with all requisitions raised against this subcontractor.
 */
export async function exportSubcontractorLedgerStatementToExcel({
  subcontractor,
  subHead,
  workOrder,
  balance,
  entries = [],
  requisitions = []
}) {
  const XLSX = await import('xlsx');

  const totalCredits = entries.reduce((sum, e) => sum + (Number(e.credit_amount || 0) || (Number(e.amount) > 0 ? Number(e.amount) : 0)), 0);
  const totalDebits = entries.reduce((sum, e) => sum + (Number(e.debit_amount || 0) || (Number(e.amount) < 0 ? Math.abs(Number(e.amount)) : 0)), 0);
  const finalBalance = balance?.available_balance != null 
    ? Number(balance.available_balance) 
    : (entries[0]?.running_balance != null ? Number(entries[0].running_balance) : (totalCredits - totalDebits));

  const workbook = XLSX.utils.book_new();

  // Sheet 1: Statement of Account / Ledger
  const statementHeader = [
    ["SN POLYMERS PVT. LTD. — SUBCONTRACTOR LEDGER STATEMENT"],
    ["Generated At (IST):", new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })],
    [],
    ["Subcontractor Name:", subcontractor || '—', "", "Work Order No.:", workOrder || 'All'],
    ["Material Sub Head:", subHead || '—', "", "Department:", balance?.project?.department || '—'],
    ["Total Allocated (Credits):", totalCredits, "", "Total Paid (Debits):", totalDebits],
    ["Available Balance (INR):", finalBalance],
    []
  ];

  const ledgerTableHeaders = [
    "Sl. No.",
    "Transaction Date (IST)",
    "Transaction Type",
    "Doc / Reference No.",
    "Description / Remarks",
    "Credit (+) (INR)",
    "Debit (-) (INR)",
    "Running Balance (INR)",
    "Actioned By"
  ];

  // In standard accounting statements, show transactions chronologically (oldest to newest)
  const entriesAsc = [...entries].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  let currentRunning = 0;
  const ledgerDataRows = entriesAsc.map((e, index) => {
    const credit = Number(e.credit_amount || 0) || (Number(e.amount) > 0 ? Number(e.amount) : 0);
    const debit = Number(e.debit_amount || 0) || (Number(e.amount) < 0 ? Math.abs(Number(e.amount)) : 0);
    currentRunning = e.running_balance != null ? Number(e.running_balance) : Number((currentRunning + Number(e.amount || 0)).toFixed(2));

    const docNo = e.requisition_no 
      ? `Req: ${e.requisition_no}` 
      : (e.reference_doc_no || (e.reference_type ? `${e.reference_type}: ${String(e.reference_id || '').slice(0, 8)}` : '—'));

    return [
      index + 1,
      e.created_at ? new Date(e.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—',
      TX_TYPE_LABELS[e.transaction_type] || e.transaction_type,
      docNo,
      e.remarks || e.item_description || '—',
      credit > 0 ? credit : 0.00,
      debit > 0 ? debit : 0.00,
      currentRunning,
      e.created_by_name || e.created_by || '—'
    ];
  });

  const summaryRow = [
    "TOTAL",
    "",
    "",
    "",
    "",
    totalCredits,
    totalDebits,
    finalBalance,
    ""
  ];

  const ledgerWorksheet = XLSX.utils.aoa_to_sheet([...statementHeader, ledgerTableHeaders, ...ledgerDataRows, [], summaryRow]);
  ledgerWorksheet['!cols'] = [
    { wch: 8 },  // Sl No
    { wch: 22 }, // Date
    { wch: 30 }, // Type
    { wch: 20 }, // Doc No
    { wch: 35 }, // Remarks
    { wch: 18 }, // Credit
    { wch: 18 }, // Debit
    { wch: 22 }, // Running Balance
    { wch: 18 }  // Actioned By
  ];

  XLSX.utils.book_append_sheet(workbook, ledgerWorksheet, "Ledger Statement");

  // Sheet 2: Requisitions Breakdown (if requisitions provided)
  if (requisitions && requisitions.length > 0) {
    const reqHeader = [
      ["Subcontractor Requisitions Breakdown — " + (subcontractor || '')],
      ["Work Order:", workOrder || 'All', "Sub Head:", subHead || '—'],
      ["Total Requisitions:", requisitions.length],
      []
    ];

    const reqTableHeaders = [
      "Sl. No.",
      "Requisition No.",
      "Work Order No.",
      "Status",
      "Requested Amount (INR)",
      "Approved Amount (INR)",
      "Effective Liability (INR)",
      "Requested By",
      "Creation Date",
      "Approved On",
      "Remarks"
    ];

    const reqDataRows = requisitions.map((r, index) => {
      const reqAmt = Number(r.requisition_amount || 0);
      const appAmt = Number(r.approved_amount || 0);
      const effectiveLiability = r.requisition_status === 'Approved' ? appAmt : 0.00;

      return [
        index + 1,
        r.requisition_no || '',
        r.work_order_no || '',
        r.requisition_status || '',
        reqAmt,
        appAmt,
        effectiveLiability,
        r.requester_name || r.requester_user_id || '',
        r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN') : '',
        r.payment_date ? new Date(r.payment_date).toLocaleDateString('en-IN') : '',
        r.remarks_approved_authority || r.remarks || ''
      ];
    });

    const reqWorksheet = XLSX.utils.aoa_to_sheet([...reqHeader, reqTableHeaders, ...reqDataRows]);
    reqWorksheet['!cols'] = [
      { wch: 8 },  // Sl No
      { wch: 18 }, // Req No
      { wch: 16 }, // WO
      { wch: 14 }, // Status
      { wch: 18 }, // Req Amt
      { wch: 18 }, // App Amt
      { wch: 20 }, // Eff Liability
      { wch: 18 }, // Requester
      { wch: 14 }, // Created
      { wch: 14 }, // Approved On
      { wch: 30 }  // Remarks
    ];
    XLSX.utils.book_append_sheet(workbook, reqWorksheet, "Requisitions Breakdown");
  }

  const cleanName = (subcontractor || 'Subcontractor').replace(/[^a-zA-Z0-9_-]/g, '_');
  XLSX.writeFile(workbook, `Subcontractor_Ledger_${cleanName}_${new Date().toISOString().split('T')[0]}.xlsx`);
}

/**
 * Exports a full, multi-sheet Subcontractor Ledger workbook across all filtered subcontractors.
 * Includes:
 *  - Sheet 1: "Ledger Transactions" (all transactions, chronological running balances)
 *  - Sheet 2: "Balances Summary" (estimated total, paid, remaining balance, utilization)
 *  - Sheet 3: "Requisitions" (detailed requisitions history)
 */
export async function exportAllSubcontractorLedgersToExcel(entries = [], balances = [], requisitions = [], metadata = {}) {
  const XLSX = await import('xlsx');

  const workbook = XLSX.utils.book_new();

  // Sheet 1: All Ledger Transactions
  const ledgerHeader = [
    ["Subcontractor Full Ledger Report — SN Polymers"],
    ["Generated At (IST):", new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })],
    ["Work Order Filter:", metadata.workOrderFilter || 'All'],
    ["Search Filter:", metadata.searchFilter || 'None'],
    ["Total Transactions:", entries.length],
    []
  ];

  const ledgerTableHeaders = [
    "Sl. No.",
    "Transaction Date (IST)",
    "Subcontractor",
    "Material Sub Head",
    "Work Order No.",
    "Transaction Type",
    "Doc / Reference No.",
    "Description / Remarks",
    "Credit (+) (INR)",
    "Debit (-) (INR)",
    "Running Balance (INR)",
    "Actioned By"
  ];

  const ledgerDataRows = entries.map((e, index) => {
    const credit = Number(e.credit_amount || 0) || (Number(e.amount) > 0 ? Number(e.amount) : 0);
    const debit = Number(e.debit_amount || 0) || (Number(e.amount) < 0 ? Math.abs(Number(e.amount)) : 0);
    const docNo = e.requisition_no 
      ? `Req: ${e.requisition_no}` 
      : (e.reference_doc_no || (e.reference_type ? `${e.reference_type}: ${String(e.reference_id || '').slice(0, 8)}` : '—'));

    return [
      index + 1,
      e.created_at ? new Date(e.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—',
      e.material_details || '—',
      e.material_sub_head || '—',
      e.work_order_no || '—',
      TX_TYPE_LABELS[e.transaction_type] || e.transaction_type,
      docNo,
      e.remarks || e.item_description || '—',
      credit > 0 ? credit : 0.00,
      debit > 0 ? debit : 0.00,
      e.running_balance != null ? Number(e.running_balance) : '—',
      e.created_by_name || e.created_by || '—'
    ];
  });

  const ledgerWorksheet = XLSX.utils.aoa_to_sheet([...ledgerHeader, ledgerTableHeaders, ...ledgerDataRows]);
  ledgerWorksheet['!cols'] = [
    { wch: 8 },  // Sl No
    { wch: 22 }, // Date
    { wch: 25 }, // Subcontractor
    { wch: 22 }, // Sub Head
    { wch: 16 }, // Work Order
    { wch: 28 }, // Type
    { wch: 18 }, // Doc No
    { wch: 30 }, // Remarks
    { wch: 18 }, // Credit
    { wch: 18 }, // Debit
    { wch: 20 }, // Running Balance
    { wch: 16 }  // Actioned By
  ];
  XLSX.utils.book_append_sheet(workbook, ledgerWorksheet, "Ledger Transactions");

  // Sheet 2: Balances Summary
  if (balances && balances.length > 0) {
    const balHeader = [
      ["Subcontractor Balances Summary"],
      ["Total Subcontractors:", balances.length],
      []
    ];
    const balTableHeaders = [
      "Sl. No.",
      "Work Order No.",
      "Department",
      "Subcontractor",
      "Material Sub Head",
      "Estimated Total (INR)",
      "Paid So Far (INR)",
      "Remaining Balance (INR)",
      "Utilization (%)"
    ];
    const balDataRows = balances.map((b, index) => {
      const est = Number(b.estimated_total || 0);
      const paid = Number(b.paid_total || 0);
      const rem = Number(b.available_balance || 0);
      const util = est > 0 ? ((paid / est) * 100).toFixed(1) + '%' : '0.0%';
      return [
        index + 1,
        b.work_order_no || '',
        b.project?.department || '',
        b.material_details || '',
        b.material_sub_head || '',
        est,
        paid,
        rem,
        util
      ];
    });
    const balWorksheet = XLSX.utils.aoa_to_sheet([...balHeader, balTableHeaders, ...balDataRows]);
    balWorksheet['!cols'] = [
      { wch: 8 }, { wch: 16 }, { wch: 16 }, { wch: 25 }, { wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 20 }, { wch: 14 }
    ];
    XLSX.utils.book_append_sheet(workbook, balWorksheet, "Balances Summary");
  }

  // Sheet 3: Requisitions
  if (requisitions && requisitions.length > 0) {
    const reqHeader = [
      ["Subcontractor Requisitions Breakdown"],
      ["Total Requisitions:", requisitions.length],
      []
    ];
    const reqTableHeaders = [
      "Sl. No.",
      "Requisition No.",
      "Work Order No.",
      "Subcontractor",
      "Material Sub Head",
      "Status",
      "Requested Amount (INR)",
      "Approved Amount (INR)",
      "Effective Liability (INR)",
      "Requested By",
      "Creation Date",
      "Approved On"
    ];
    const reqDataRows = requisitions.map((r, index) => [
      index + 1,
      r.requisition_no || '',
      r.work_order_no || '',
      r.material_details || '',
      r.material_sub_head || '',
      r.requisition_status || '',
      Number(r.requisition_amount || 0),
      Number(r.approved_amount || 0),
      r.requisition_status === 'Approved' ? Number(r.approved_amount || 0) : 0.00,
      r.requester_name || r.requester_user_id || '',
      r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN') : '',
      r.payment_date ? new Date(r.payment_date).toLocaleDateString('en-IN') : ''
    ]);
    const reqWorksheet = XLSX.utils.aoa_to_sheet([...reqHeader, reqTableHeaders, ...reqDataRows]);
    reqWorksheet['!cols'] = [
      { wch: 8 }, { wch: 18 }, { wch: 16 }, { wch: 25 }, { wch: 22 }, { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 20 }, { wch: 18 }, { wch: 14 }, { wch: 14 }
    ];
    XLSX.utils.book_append_sheet(workbook, reqWorksheet, "Requisitions");
  }

  XLSX.writeFile(workbook, `Subcontractor_Full_Ledger_${new Date().toISOString().split('T')[0]}.xlsx`);
}

/**
 * Exports a combined Inflow (Fund Requests) vs Outflow (Payment Requisitions)
 * Expenditure Sheet matching Modify_Exp_Sheet_Sep26.xlsx format.
 *
 * Layout:
 *  - Left side (Cols A-C): Approved Fund Requests (Inflows)
 *  - Col D: 'P' Divider
 *  - Right side (Cols E-Q): Payment Requisitions (Outflows)
 *  - Dynamic 2nd & 3rd fields for Sub Contractor requisitions
 *  - Structured Beneficiary Name, Account Number, IFSC, and Bank Name
 */
export async function exportCombinedExpenditureSheet({
  fundRequests = [],
  requisitions = [],
  metadata = {},
  dateRange
} = {}) {
  const XLSX = await import('xlsx');

  // Filter fund requests and requisitions by workOrder & dateRange
  let filteredFrs = [...fundRequests];
  let filteredReqs = [...requisitions];

  if (metadata.workOrderFilter && metadata.workOrderFilter !== 'All') {
    const wo = metadata.workOrderFilter.trim().toLowerCase();
    filteredFrs = filteredFrs.filter(f => (f.work_order_no || '').toLowerCase() === wo);
    filteredReqs = filteredReqs.filter(r => (r.work_order_no || '').toLowerCase() === wo);
  }

  if (dateRange) {
    const start = dateRange.start || dateRange.startDate;
    const end = dateRange.end || dateRange.endDate;
    if (start) {
      const startDate = new Date(start);
      startDate.setHours(0, 0, 0, 0);
      filteredFrs = filteredFrs.filter(f => {
        const d = new Date(f.approve_ho_date || f.zo_date || f.created_at);
        return d >= startDate;
      });
      filteredReqs = filteredReqs.filter(r => {
        const d = new Date(r.payment_date || r.created_at || r.login_date);
        return d >= startDate;
      });
    }
    if (end) {
      const endDate = new Date(end);
      endDate.setHours(23, 59, 59, 999);
      filteredFrs = filteredFrs.filter(f => {
        const d = new Date(f.approve_ho_date || f.zo_date || f.created_at);
        return d <= endDate;
      });
      filteredReqs = filteredReqs.filter(r => {
        const d = new Date(r.payment_date || r.created_at || r.login_date);
        return d <= endDate;
      });
    }
  }

  if (filteredFrs.length === 0 && filteredReqs.length === 0) {
    alert('No fund requests or payment requisitions found matching the selected criteria.');
    return;
  }

  // Row 1: Empty row
  const row1 = Array(17).fill('');

  // Row 2: Note merged over H2:I2 (col index 7 and 8)
  const row2 = Array(17).fill('');
  row2[7] = 'If Material Main Head is “Sub Contractor” \nthe selected 2nd and 3rd dropdown values should be displayed in the 2nd and 3rd fields.';

  // Row 3: 17 Headers matching Modify_Exp_Sheet_Sep26.xlsx
  const row3 = [
    'Date',
    'Approved amount of the ZO → HO Fund Request.',
    'HO Approved Amount',
    'P',
    'Date',
    'JE Requisition No',
    'Material Main Head',
    '2nd Field',
    '3rd Field',
    'Remarks',
    'ZO Approved Amount',
    'Beneficiary Name',
    'Account No',
    'IFSC Code',
    'Bank Name',
    'Work_Order',
    'Work Order Details'
  ];

  const maxRows = Math.max(filteredFrs.length, filteredReqs.length);
  const dataRows = [];

  const formatDateVal = (dateStr) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch {
      return '';
    }
  };

  for (let i = 0; i < maxRows; i++) {
    const fr = filteredFrs[i] || null;
    const req = filteredReqs[i] || null;

    // Left Side: Inflow (ZO -> HO Fund Request)
    const frDate = fr ? formatDateVal(fr.approve_ho_date || fr.zo_date || fr.created_at) : '';
    const frDesc = fr ? (fr.transfer_from_account ? `Received from SNP (${fr.transfer_from_account})` : 'Received from SNP (NEFT)') : '';
    const frAmount = fr ? (Number(fr.approve_ho_amount || fr.zo_fr_amount || 0)) : null;

    // Right Side: Outflow (Payment Requisition)
    const reqDate = req ? formatDateVal(req.payment_date || req.created_at || req.login_date) : '';
    const reqNo = req ? (req.requisition_no || '') : '';
    const mainHead = req ? (req.material_main_head || '') : '';
    const isSubContractor = (mainHead || '').trim() === 'Sub Contractor';
    const secondField = (req && isSubContractor) ? (req.material_sub_head || '') : '';
    const thirdField = (req && isSubContractor) ? (req.material_details || '') : '';
    const remarks = req ? (req.remarks_approved_authority || req.expen_head_remarks || '') : '';
    const zoApprovedAmount = req ? Number(req.approved_amount ?? req.requisition_amount ?? 0) : null;
    const beneficiaryName = req ? (req.beneficiary_name || (isSubContractor ? req.material_details : '') || '') : '';
    const accountNo = req ? (req.beneficiary_ac_no || '') : '';
    const ifscCode = req ? (req.beneficiary_ifsc || '') : '';
    const bankName = req ? (req.beneficiary_bank_name || '') : '';
    const workOrder = req ? (req.work_order_no || '') : '';
    const workOrderDetails = req ? (req.site_details || '') : '';

    dataRows.push([
      frDate,
      frDesc,
      frAmount,
      '', // Column D (P)
      reqDate,
      reqNo,
      mainHead,
      secondField,
      thirdField,
      remarks,
      zoApprovedAmount,
      beneficiaryName,
      accountNo,
      ifscCode,
      bankName,
      workOrder,
      workOrderDetails
    ]);
  }

  const aoa = [row1, row2, row3, ...dataRows];
  const worksheet = XLSX.utils.aoa_to_sheet(aoa);

  // Column widths exactly matching Modify_Exp_Sheet_Sep26.xlsx
  worksheet['!cols'] = [
    { wch: 12 }, // A: Date
    { wch: 50 }, // B: Approved amount of ZO -> HO Fund Request
    { wch: 22 }, // C: HO Approved Amount
    { wch: 13 }, // D: P
    { wch: 12 }, // E: Date
    { wch: 18 }, // F: JE Requisition No
    { wch: 20 }, // G: Material Main Head
    { wch: 24 }, // H: 2nd Field
    { wch: 22 }, // I: 3rd Field
    { wch: 12 }, // J: Remarks
    { wch: 22 }, // K: ZO Approved Amount
    { wch: 55 }, // L: Beneficiary Name
    { wch: 20 }, // M: Account No
    { wch: 15 }, // N: IFSC Code
    { wch: 14 }, // O: Bank Name
    { wch: 16 }, // P: Work_Order
    { wch: 22 }  // Q: Work Order Details
  ];

  // Merge H2:I2 (col index 7 to 8 in 0-indexed coords)
  worksheet['!merges'] = [
    { s: { r: 1, c: 7 }, e: { r: 1, c: 8 } }
  ];

  // Number formatting for Column C (HO Approved Amount) and Column K (ZO Approved Amount)
  for (let r = 3; r < aoa.length; r++) {
    const cRef = XLSX.utils.encode_cell({ r, c: 2 });
    if (worksheet[cRef] && typeof worksheet[cRef].v === 'number') {
      worksheet[cRef].z = '#,##0.00';
    }
    const kRef = XLSX.utils.encode_cell({ r, c: 10 });
    if (worksheet[kRef] && typeof worksheet[kRef].v === 'number') {
      worksheet[kRef].z = '#,##0.00';
    }
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");

  const dateSuffix = new Date().toISOString().split('T')[0];
  const cleanWo = (metadata.workOrderFilter && metadata.workOrderFilter !== 'All') ? `_${metadata.workOrderFilter.replace(/[^a-zA-Z0-9_-]/g, '_')}` : '';
  const filename = `Expenditure_Sheet${cleanWo}_${dateSuffix}.xlsx`;
  XLSX.writeFile(workbook, filename);
}



