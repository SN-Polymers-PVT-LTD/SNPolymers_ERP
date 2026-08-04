export const filterStaffPendingRequisitions = (requisitions = []) =>
  requisitions.filter(r => r.requisition_status === 'Pending');

export const getPendingRequisitionAmount = (req = {}) =>
  Number(req.requisition_amount || req.requested_amount || 0);
