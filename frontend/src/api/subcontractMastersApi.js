import authApi from './authApi';

export const getSubcontractWorks = (params) => authApi.get('/subcontract-works', { params });
export const getSubcontractWork = (id) => authApi.get(`/subcontract-works/${id}`);
export const createSubcontractWork = (data) => authApi.post('/subcontract-works', data);
export const updateSubcontractWork = (id, data) => authApi.put(`/subcontract-works/${id}`, data);
export const updateSubcontractWorkStatus = (id, is_active) => authApi.patch(`/subcontract-works/${id}/status`, { is_active });

export const getSubcontractors = (params) => authApi.get('/subcontractors', { params });
export const getSubcontractor = (id) => authApi.get(`/subcontractors/${id}`);
export const createSubcontractor = (data) => authApi.post('/subcontractors', data);
export const updateSubcontractor = (id, data) => authApi.put(`/subcontractors/${id}`, data);
export const updateSubcontractorStatus = (id, is_active) => authApi.patch(`/subcontractors/${id}/status`, { is_active });
export const getSubcontractorAssignments = (params) => authApi.get('/subcontractors/assignments', { params });
export const createSubcontractorAssignment = (data) => authApi.post('/subcontractors/assignments', data);

export const fetchAllActiveSubcontractors = async (fetcher = getSubcontractors) => {
  let allSubcontractors = [];
  let page = 1;
  let totalPages = null;

  do {
    const response = await fetcher({ is_active: 'true', page, limit: 1000 });
    const data = response?.data;
    if (!data || !Array.isArray(data.subcontractors)) {
      throw new Error('Invalid response structure from subcontractors API: missing subcontractors list.');
    }

    const pagination = data.pagination;
    if (
      !pagination ||
      typeof pagination.totalPages !== 'number' ||
      !Number.isInteger(pagination.totalPages) ||
      pagination.totalPages < 1 ||
      typeof pagination.page !== 'number'
    ) {
      throw new Error('Invalid or missing pagination metadata from subcontractors API.');
    }

    if (totalPages === null) {
      totalPages = pagination.totalPages;
    }

    allSubcontractors = allSubcontractors.concat(data.subcontractors);
    page += 1;
  } while (page <= totalPages);

  return allSubcontractors;
};
