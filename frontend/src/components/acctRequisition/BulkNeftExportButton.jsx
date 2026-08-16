import React, { useState } from 'react';
import { Button } from '../ui';
import { exportBulkNeft } from '../../api/acctRequisitionsApi';

/**
 * The backend endpoint currently returns a JSON placeholder (marks items
 * neft_exported, no binary file yet — see acctRequisition.controller.js).
 * This button surfaces that honestly instead of pretending a file download
 * happened.
 */
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
      setIsError(false);
      setMessage(res.data?.message || 'Export validated.');
      onExported?.(res.data?.exportedItemIds || []);
    } catch (err) {
      setIsError(true);
      setMessage(err.response?.data?.message || 'Failed to export Bulk NEFT.');
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
