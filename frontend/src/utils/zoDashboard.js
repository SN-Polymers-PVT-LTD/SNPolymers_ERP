/**
 * Resolve JE assignments from a project record.
 * Prefers `assigned_jes` array from API; falls back to legacy string/single-JE fields.
 */
const resolveAssignedJes = (p) => {
  if (Array.isArray(p.assigned_jes) && p.assigned_jes.length > 0) {
    return p.assigned_jes;
  }
  if (p.je_user_id) {
    return [{
      mobile_number: p.je_user_id,
      name: p.je_name || p.assigned_je || p.je_user_id
    }];
  }
  const nameRaw = p.je_name || p.assigned_je || p.assigned_to;
  if (!nameRaw) return [];
  return nameRaw.split(',').map(n => n.trim()).filter(Boolean).map(name => ({
    mobile_number: name,
    name
  }));
};

/**
 * Filter projects to those owned by the logged-in ZO (zo_user_id match only).
 */
export const filterProjectsByZoId = (projects = [], zoUserId = '') => {
  const mob = (zoUserId || '').toLowerCase().trim();
  if (!mob) return projects;
  return projects.filter(p => (p.zo_user_id || '').toLowerCase().trim() === mob);
};

/**
 * Shared business utility to build Junior Engineer (JE) stats for the Zonal Office dashboard and leaderboards.
 * 
 * Conceptually:
 * Projects -> Unique JE List (Set of Work Orders) -> LEFT JOIN leaderboard -> Render
 * 
 * @param {Array} projects - The list of projects returned by projects health API.
 * @param {Array} leaderboardData - Optional weekly/timeframe-based leaderboard data from the backend.
 * @returns {Array} List of JEs with count, streak, avg, status, score, and reports.
 */
export const buildJeStats = (projects, leaderboardData = []) => {
  const map = new Map();

  // 1. Initialize map with unique JEs and count assigned projects/work orders (Set-based to avoid duplicate rows)
  (projects || []).forEach(p => {
    const assignedJes = resolveAssignedJes(p);
    assignedJes.forEach(je => {
      const { mobile_number: mobile, name } = je;
      if (!mobile) return;
      if (!map.has(mobile)) {
        map.set(mobile, {
          name: name || mobile,
          mobile_number: mobile,
          workOrders: new Set(),
          totalProgress: 0,
          streak: 0,
          avg: 0,
          status: 'Warning',
          score: 0,
          reports: 0
        });
      }
      const item = map.get(mobile);
      if (!item.workOrders.has(p.work_order_no)) {
        item.workOrders.add(p.work_order_no);
        item.totalProgress += Number(p.physical_progress || 0);
        item.reports += Number(p.total_dpr_count || p.dpr_count || 0);
      }
    });
  });

  // 2. Left join leaderboard metrics onto the project-derived JE list using unique mobile_number
  const leaderboardList = Array.isArray(leaderboardData) ? leaderboardData : [];
  leaderboardList.forEach(j => {
    const mobile = j.mobile_number;
    if (!mobile) return;
    if (map.has(mobile)) {
      const item = map.get(mobile);
      item.reports = Number(j.total_reports ?? item.reports ?? 0);
      item.streak = Number(j.daily_streak || j.streak || 0);
      item.score = Number(j.score || 0);
      // avg/status for assigned JEs come from portfolio in step 3, not weekly leaderboard
      if (item.workOrders.size === 0) {
        const avg = j.avg_progress || 0;
        item.avg = avg;
        if (avg >= 70) item.status = 'Excellent';
        else if (avg < 40) item.status = 'Warning';
        else item.status = 'Active';
      }
    } else {
      // JE is in the leaderboard but has no active project assignments in this zone
      const avg = j.avg_progress || 0;
      let status = 'Active';
      if (avg >= 70) status = 'Excellent';
      else if (avg < 40) status = 'Warning';
      
      map.set(mobile, {
        name: j.display_name || mobile,
        mobile_number: mobile,
        workOrders: new Set(),
        totalProgress: 0,
        streak: Number(j.daily_streak || j.streak || 0),
        avg,
        status,
        score: Number(j.score || 0),
        reports: Number(j.total_reports || 0)
      });
    }
  });

  // 3. Map to final display format; portfolio avg/status when JE has project assignments
  return Array.from(map.values()).map(je => {
    const count = je.workOrders.size;
    let avg = je.avg;
    let status = je.status;
    if (count > 0) {
      avg = Math.round(je.totalProgress / count);
      if (avg >= 70) status = 'Excellent';
      else if (avg < 40) status = 'Warning';
      else status = 'Active';
    }
    return {
      name: je.name,
      mobile_number: je.mobile_number,
      count,
      projects: count,
      streak: je.streak,
      avg,
      status,
      score: je.score,
      reports: je.reports
    };
  });
};

/** Share of total JE assignment slots (shared WOs counted per JE). */
export const computeWorkloadShare = (jeCount, totalAssignments) => {
  const total = totalAssignments || 1;
  return Math.min(100, Math.round((jeCount / total) * 100));
};
