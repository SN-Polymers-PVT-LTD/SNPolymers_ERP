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


