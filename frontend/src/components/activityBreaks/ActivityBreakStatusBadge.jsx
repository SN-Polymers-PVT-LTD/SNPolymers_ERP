import React from 'react';
import { Badge } from '../ui';

// 7 canonical status values per §2 / state machine
const STATUS_CONFIG = {
  'Pending ZO Review':  { variant: 'amber',   label: 'Pending ZO Review'  },
  'Pending HO Review':  { variant: 'amber',   label: 'Pending HO Review'  },
  'Active':             { variant: 'emerald', label: 'Active'              },
  'Reopen Requested':   { variant: 'amber',   label: 'Reopen Requested'   },
  'Rejected by ZO':     { variant: 'red',     label: 'Rejected by ZO'     },
  'Cancelled by JE':    { variant: 'slate',   label: 'Cancelled by JE'    },
  'Ended':              { variant: 'slate',   label: 'Ended'              },
};

const ActivityBreakStatusBadge = ({ status }) => {
  const s = STATUS_CONFIG[status] ?? { variant: 'slate', label: status || 'Unknown' };
  return (
    <Badge variant={s.variant} showDot={true}>
      {s.label}
    </Badge>
  );
};

export default ActivityBreakStatusBadge;
