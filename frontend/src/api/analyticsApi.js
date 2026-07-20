import authApi from './authApi';

export const getHoKpis              = ()       => authApi.get('/analytics/ho/kpis');
export const getHoResourceUtil      = ()       => authApi.get('/analytics/ho/resource-utilization');
export const getHoApprovalSla       = (params) => authApi.get('/analytics/ho/approval-sla', { params });
export const getHoZoneBenchmarking  = ()       => authApi.get('/analytics/ho/zone-benchmarking');
export const getHoBudgetLeakage     = ()       => authApi.get('/analytics/ho/budget-leakage');
export const getZoProductivity      = ()       => authApi.get('/analytics/zo/productivity');
export const getRecentActivity      = ()       => authApi.get('/analytics/recent-activity');
export const getAuditLog            = (params) => authApi.get('/analytics/audit-log', { params });
export const getProjectDigitalTwin  = (wo)     => authApi.get(`/analytics/project/${wo}/digital-twin`);
export const refreshAnalyticsViews  = ()       => authApi.post('/analytics/refresh');
export const getProjectsHealth      = ()       => authApi.get('/analytics/projects');
export const getHoActionableInsights = ()       => authApi.get('/analytics/ho/actionable-insights');
export const getHoChartData          = (params) => authApi.get('/analytics/ho/chart-data', { params });
