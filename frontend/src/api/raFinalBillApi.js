import authApi from './authApi';

export const getBills           = (params = {})      => authApi.get('/ra-final-bills', { params });
export const getBillById        = (id)               => authApi.get(`/ra-final-bills/${id}`);
export const createBill         = (data)             => authApi.post('/ra-final-bills', data);
export const getBillSummary     = (work_order_no)    =>
  authApi.get(`/ra-final-bills/summary/${encodeURIComponent(work_order_no)}`);

export const uploadBillCopy = (file) => {
  const formData = new FormData();
  formData.append('file', file);
  return authApi.post('/ra-final-bills/upload/bill-copy', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
};
