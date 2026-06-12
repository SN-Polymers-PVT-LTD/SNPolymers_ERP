import authApi from './authApi';

// ──────────────────────────────────────────────
//  Projects Master API
//  Base URL → /api/v1/auth/projects  (mounted in app.js)
// ──────────────────────────────────────────────

/** Fetch all projects */
export const getProjects = () => authApi.get('/projects');

/** Create a new project (admin only)
 *  @param {Object} data – { work_order_no, estimate_no, site_details, state, district, zone, department }
 */
export const createProject = (data) => authApi.post('/projects', data);

/** Edit standard fields of a project (admin only).
 *  `work_order_no` is intentionally excluded – the backend will reject it.
 *  @param {string} workOrderNo
 *  @param {Object} data
 */
export const updateProject = (workOrderNo, data) =>
  authApi.put(`/projects/${encodeURIComponent(workOrderNo)}`, data);

/** Change project status (admin only).
 *  @param {string} workOrderNo
 *  @param {'Running'|'Closed'|'Complete Under Maintenance'} status
 */
export const updateProjectStatus = (workOrderNo, status) =>
  authApi.patch(`/projects/${encodeURIComponent(workOrderNo)}/status`, { status });
