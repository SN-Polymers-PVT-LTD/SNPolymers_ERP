/** Editable estimate statuses where quotation CRUD is permitted for creators */
const EDITABLE_STATUSES = ['Draft', 'ZO Revision Requested', 'HO Revision Requested', 'Estimate Reopened'];

/** Check if user can upload a quotation */
export const canUploadQuotation = (estimate, user) => {
  if (!estimate || !user) return false;
  if (user.role === 'admin') return true;
  
  const isJE = user.role === 'je' || user.role === 'staff';
  const isOwner = estimate.created_by === user.mobile_number;
  const isEditable = EDITABLE_STATUSES.includes(estimate.estimate_status);

  return isJE && isOwner && isEditable;
};

/** Check if user can delete a quotation */
export const canDeleteQuotation = (quotation, estimate, user) => {
  if (!quotation || !estimate || !user || quotation.is_locked) return false;
  if (user.role === 'admin') return true;

  const isJE = user.role === 'je' || user.role === 'staff';
  const isOwner = estimate.created_by === user.mobile_number;
  const isEditable = EDITABLE_STATUSES.includes(estimate.estimate_status);

  return isJE && isOwner && isEditable;
};

/** Check if user can flag a quotation */
export const canFlagQuotation = (estimate, user) => {
  if (!estimate || !user) return false;
  return ['zo', 'ho', 'admin'].includes(user.role);
};
