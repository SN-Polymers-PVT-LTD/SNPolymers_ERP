import authApi from './authApi';

export const getProgressReports    = (params = {}) => authApi.get('/daily-progress', { params });
export const getProgressReportById = (id)          => authApi.get(`/daily-progress/${id}`);
export const createProgressReport  = (data)        => authApi.post('/daily-progress', data);
export const addAuthorityRemarks   = (id, data)    => authApi.patch(`/daily-progress/${id}/remarks`, data);

export const uploadSitePhoto = (file) => {
  const formData = new FormData();
  formData.append('file', file);
  return authApi.post('/daily-progress/upload/photo', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
};
