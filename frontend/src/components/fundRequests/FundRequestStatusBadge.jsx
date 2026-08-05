import React from 'react';
import { Badge } from '../ui';

const STATUS_CONFIG = {
  Pending: { variant: 'amber', label: 'Pending' },
  Approved: { variant: 'emerald', label: 'Approved' },
  Hold: { variant: 'red', label: 'Hold' },
  Cancelled: { variant: 'slate', label: 'Cancelled' }
};

const FundRequestStatusBadge = ({ status }) => {
  const s = STATUS_CONFIG[status] ?? STATUS_CONFIG['Pending'];
  return (
    <Badge variant={s.variant} showDot={true}>
      {s.label}
    </Badge>
  );
};

export default FundRequestStatusBadge;
