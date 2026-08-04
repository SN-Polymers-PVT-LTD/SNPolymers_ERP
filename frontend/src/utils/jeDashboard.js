import { getLatestDprByVisitDate, computeConsecutiveStreakFromVisitDates } from './dprUtils';

export const DEFAULT_ESTIMATE_STATUS = 'No Estimate Drafted';

export const buildJeMappedProjects = (projects = [], estimates = [], requisitions = [], dprReports = []) =>
  projects.map(p => {
    const matchingEst = estimates.find(e => e.work_order_no === p.work_order_no);
    const reqCount = requisitions.filter(r => r.work_order_no === p.work_order_no).length;

    const projectDprs = dprReports.filter(d => d.work_order_no === p.work_order_no);
    const latestDpr = getLatestDprByVisitDate(projectDprs);

    const physicalProg = latestDpr
      ? Number(latestDpr.physical_work_progress || 0)
      : Number(p.physical_progress || 0);

    const lastLoggedText = latestDpr?.site_visit_date
      ? `logged ${new Date(latestDpr.site_visit_date).toLocaleDateString('en-IN')}`
      : 'no logs yet';

    return {
      wo: p.work_order_no,
      location: p.site_details || 'Site Location',
      progress: physicalProg,
      estimates: matchingEst?.estimate_status || DEFAULT_ESTIMATE_STATUS,
      requisitions: reqCount,
      lastLogged: lastLoggedText
    };
  });

export const resolveJeStreakCount = (user, dprReports = []) => {
  if (user?.daily_streak && Number(user.daily_streak) > 0) return Number(user.daily_streak);
  const dates = dprReports.map(r => r.site_visit_date).filter(Boolean);
  return computeConsecutiveStreakFromVisitDates(dates);
};

export const resolveActiveZoMapping = (mappingsRes, user, projects = []) => {
  const list = mappingsRes?.mappings || (Array.isArray(mappingsRes) ? mappingsRes : []);
  if (list.length > 0) {
    const mob = (user?.mobile_number || '').replace(/\D/g, '');
    const match = list.find(m => {
      const jMob = (m.je_user_id || '').replace(/\D/g, '');
      return (jMob && mob && jMob === mob) || m.je_user_id === user?.mobile_number;
    });
    if (match) return match;
    return list.find(m => m.is_active !== false) || list[0];
  }

  const projWithZo = projects.find(p => p.zo_name || p.zo_user_id || p.zone);
  if (projWithZo) {
    return {
      zo_name: projWithZo.zo_name || projWithZo.zone || 'Zonal Office',
      zo_user_id: projWithZo.zo_user_id || 'N/A'
    };
  }

  return null;
};

export const countEstimateBuckets = (estimates = []) => {
  const approvedEstsCount = estimates.filter(
    e => (e.estimate_status || '').toLowerCase().includes('approved')
  ).length;
  const pendingEstsCount = estimates.length - approvedEstsCount;
  return { approvedEstsCount, pendingEstsCount };
};
