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

const BulkNeftExportButton = ({ sheetId, selectedItemIds, onExported }) => {
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);

  const handleExport = async () => {
    if (!selectedItemIds?.length) {
      setIsError(true);
      setMessage('Select at least one item to export.');
      return;
    }
    setSubmitting(true);
    setMessage('');
    try {
      const res = await exportBulkNeft(sheetId, { item_ids: selectedItemIds });

      const link = document.createElement('a');
      link.href = URL.createObjectURL(res.data);
      link.download = `Bulk_NEFT_${sheetId}.xlsx`;
      link.click();

      setIsError(false);
      setMessage(`Exported ${selectedItemIds.length} item(s).`);
      onExported?.(selectedItemIds);
    } catch (err) {
      setIsError(true);
      setMessage((await extractErrorMessage(err)) || 'Failed to export Bulk NEFT.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Button variant="glass" size="sm" onClick={handleExport} loading={submitting}>
        Export Bulk NEFT ({selectedItemIds?.length || 0})
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
