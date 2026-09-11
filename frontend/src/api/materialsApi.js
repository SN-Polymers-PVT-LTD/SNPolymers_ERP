import authApi from './authApi';

// ──────────────────────────────────────────────
//  Material Master API
//  Base URL → /api/v1/auth/materials (mounted in app.js)
// ──────────────────────────────────────────────

/** Fetch all materials with search/filters/pagination */
export const getMaterials = (params) => authApi.get('/materials', { params });

/** Fetch all unique categories (Main Heads & Sub Heads) for filtering options */
export const getMaterialCategories = () => authApi.get('/materials/categories');

/** Fetch a single material by ID */
export const getMaterialById = (id) => authApi.get(`/materials/${id}`);

/** Create a new material (admin or JE) */
export const createMaterial = (data) => authApi.post('/materials', data);

/** Update a material (admin only) */
export const updateMaterial = (id, data) => authApi.put(`/materials/${id}`, data);

/** Disable/Enable material (admin or JE) */
export const updateMaterialStatus = (id, is_active) => authApi.patch(`/materials/${id}/status`, { is_active });
