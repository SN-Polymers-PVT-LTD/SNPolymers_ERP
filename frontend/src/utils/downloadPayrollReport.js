export function downloadPayrollReport(response, filename) {
  const objectUrls = URL;
  const url = objectUrls.createObjectURL(response.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => objectUrls.revokeObjectURL(url), 1000);
}

export async function payrollExportError(error) {
  if (error.response?.data instanceof Blob) {
    try {
      error.message = JSON.parse(await error.response.data.text()).message || error.message;
    } catch {
      // Keep the transport message when the response is not JSON.
    }
  }
  return error;
}
