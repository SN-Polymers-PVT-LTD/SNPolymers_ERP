import React from 'react';
import { Badge } from '../ui';

// Reads is_reopened / reopened_at / reopened_by. NOTE: last_ho_actioned_by
// (the person who took the PRIOR HO action, e.g. who rejected the item) is
// intentionally not used here — reopened_by is the column for "who reopened
// this", which is what "Reopened on [date] by [user]" needs to show.
const ReopenedBadge = ({ item }) => {
  if (!item?.is_reopened) return null;

  const dateStr = item.reopened_at
    ? new Date(item.reopened_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : null;

  return (
    <Badge variant="indigo" title={item.reopen_remark || undefined}>
      Reopened{dateStr ? ` on ${dateStr}` : ''}{item.reopened_by ? ` by ${item.reopened_by}` : ''}
    </Badge>
  );
};

export default ReopenedBadge;
