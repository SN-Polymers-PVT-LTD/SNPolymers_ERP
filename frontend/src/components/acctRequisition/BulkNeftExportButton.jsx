import React, { useState } from 'react';
import { Button } from '../ui';
import { exportBulkNeft } from '../../api/acctRequisitionsApi';

// exportBulkNeft (responseType: 'blob') puts a JSON error body's bytes on
// err.response.data as a Blob, not a parsed object — this reads it back the
// same way BulkNeftExportButton's old JSON-response error handling did.
const extractErrorMessage = async (err) => {
  const data = err.response?.data;
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text());
      return parsed.message;
    } catch {
      return null;
    }
  }
  return err.response?.data?.message || null;
};

const safeFilenamePart = (str) => (str || 'Unknown').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// No manual row selection — exports every eligible (Bulk NEFT, Approved or
// Partially Approved) item on the sheet in one go. The backend's Bulk NEFT
// letter is inherently single-bank (it's a real authorization letter
// addressed to one branch/account, see bulkNeftExport.service.js) and
// rejects a mixed-bank batch outright. Grouping by debit bank here and
// issuing one export call per bank keeps that per-letter guarantee intact;
// a single bank still downloads its .xlsx directly as before, while
// multiple banks get zipped into one download (one Bulk NEFT letter per
// bank inside it) instead of erroring out or losing items silently.
const BulkNeftExportButton = ({ sheetId, items = [], onExported }) => {
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);

  const byBank = items.reduce((acc, item) => {
    const bank = item.debit_bank_ac_type || 'Unknown';
    (acc[bank] = acc[bank] || []).push(item.id);
    return acc;
  }, {});
  const bankNames = Object.keys(byBank);

  const handleExport = async () => {
    if (items.length === 0) return;
    setSubmitting(true);
    setMessage('');
    try {
      if (bankNames.length === 1) {
        const res = await exportBulkNeft(sheetId, { item_ids: byBank[bankNames[0]] });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(res.data);
        link.download = `Bulk_NEFT_${safeFilenamePart(bankNames[0])}.xlsx`;
        link.click();
        URL.revokeObjectURL(link.href);
      } else {
        const JSZip = (await import('jszip')).default;
        const zip = new JSZip();
        for (const bank of bankNames) {
          const res = await exportBulkNeft(sheetId, { item_ids: byBank[bank] });
          zip.file(`Bulk_NEFT_${safeFilenamePart(bank)}.xlsx`, res.data);
        }
        const content = await zip.generateAsync({ type: 'blob' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(content);
        link.download = `Bulk_NEFT_${sheetId}.zip`;
        link.click();
        URL.revokeObjectURL(link.href);
      }

      setIsError(false);
      setMessage(`Exported ${items.length} item(s) across ${bankNames.length} bank(s).`);
      onExported?.(items.map((i) => i.id));
    } catch (err) {
      setIsError(true);
      setMessage((await extractErrorMessage(err)) || 'Failed to export Bulk NEFT.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Button variant="glass" size="sm" onClick={handleExport} loading={submitting} disabled={items.length === 0}>
        Export Bulk NEFT{items.length > 0 ? ` (${items.length})` : ''}
      </Button>
      {message && (
        <p className={`text-[10px] font-semibold ${isError ? 'text-red-400' : 'text-emerald-400'}`}>
          {message}
        </p>
      )}
    </div>
  );
};

export default BulkNeftExportButton;
