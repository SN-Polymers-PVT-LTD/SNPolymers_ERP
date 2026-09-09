import React from 'react';
import { Badge } from '../ui';

// Reads source_requisition (set by getSheetById when source_requisition_id is
// present) — shown on line items created automatically by ZO "Send to
// Accounts" routing, so Accounts can trace the item back to its originating
// Payment Requisition.
const SourceRequisitionBadge = ({ item }) => {
  if (!item?.source_requisition) return null;

  const { requisition_no, accounts_sent_by, accounts_sent_at } = item.source_requisition;
  const dateStr = accounts_sent_at
    ? new Date(accounts_sent_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : null;

  return (
    <Badge variant="indigo" title={dateStr ? `Sent by ${accounts_sent_by || 'ZO'} on ${dateStr}` : undefined}>
      From Requisition {requisition_no}
    </Badge>
  );
};

export default SourceRequisitionBadge;
