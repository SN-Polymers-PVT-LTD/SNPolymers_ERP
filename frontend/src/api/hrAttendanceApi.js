import authApi from './authApi';
export const getAttendanceRoster = params => authApi.get('/hr/attendance/roster', { params });
export const loadAttendanceSheet = params => authApi.get('/hr/attendance/sheet', { params });
export const populateAttendanceSheet = body => authApi.post('/hr/attendance/sheets', body);
export const saveAttendanceRows = (id, rows) => authApi.put(`/hr/attendance/sheets/${id}/rows`, { rows });
export const saveFactoryLeave = (id, body) => authApi.post(`/hr/attendance/sheets/${id}/leave`, body);
export const submitAttendanceSheet = id => authApi.post(`/hr/attendance/sheets/${id}/submit`, {});
export const getAttendanceHistory = (id, params) => authApi.get(`/hr/attendance/sheets/${id}/history`, { params });
