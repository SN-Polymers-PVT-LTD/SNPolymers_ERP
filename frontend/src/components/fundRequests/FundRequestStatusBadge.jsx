import React from 'react';
import { Badge } from '../ui';

const STATUS_CONFIG = {
  Draft: { variant: 'slate', label: 'Draft' },
  Pending: { variant: 'amber', label: 'Pending' },
  Approved: { variant: 'emerald', label: 'Approved' },
  Hold: { variant: 'amber', label: 'On Hold' },
  Returned: { variant: 'violet', label: 'Returned' },
  Rejected: { variant: 'red', label: 'Rejected' },
  Cancelled: { variant: 'slate', label: 'Cancelled' }
};

const FundRequestStatusBadge = ({ status, isImported = false, isDismissed = false }) => {
  if (isDismissed) {
    return (
      <Badge variant="slate" showDot={true}>
        Dismissed
      </Badge>
    );
  }
  if (status === 'Pending' && isImported) {
    return (
      <Badge variant="indigo" showDot={true}>
        In Accounts Sheet
      </Badge>
    );
  }
  const s = STATUS_CONFIG[status] ?? STATUS_CONFIG['Pending'];
  return (
    <Badge variant={s.variant} showDot={true}>
      {s.label}
    </Badge>
  );
};

export default FundRequestStatusBadge;
