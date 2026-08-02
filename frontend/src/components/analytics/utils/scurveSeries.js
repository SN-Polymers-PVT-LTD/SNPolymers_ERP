const SIGMOIDAL_PLANNED = [2, 12, 35, 65, 88, 98];
const MIN_DPR_POINTS_FOR_REAL_HISTORY = 3;
const SIGMOID_STEEPNESS = 9;

function parseLocalDate(dateStr) {
  if (!dateStr) return null;
  const parts = String(dateStr).slice(0, 10).split('-');
  if (parts.length !== 3) return null;
  const [year, month, day] = parts.map(Number);
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return null;
  return new Date(year, month - 1, day);
}

function isValidProjectWindow(startDate, endDate) {
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);
  if (!start || !end) return false;
  return end > start;
}

function monthMidpoint(monthKey) {
  const parts = String(monthKey).split('-');
  if (parts.length !== 2) return null;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  if (Number.isNaN(year) || Number.isNaN(month)) return null;
  return new Date(year, month - 1, 15);
}

function formatMonthLabel(ym) {
  if (!ym) return '';
  const str = String(ym).trim();
  const parts = str.split('-');
  if (parts.length === 2) {
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    if (!Number.isNaN(year) && !Number.isNaN(month)) {
      const d = new Date(year, month, 1);
      if (!Number.isNaN(d.getTime())) return d.toLocaleString('en-US', { month: 'short' });
    }
  } else {
    const d = new Date(str);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString('en-US', { month: 'short' });
  }
  return str;
}

function plannedPctAtElapsed(elapsedRatio, k = SIGMOID_STEEPNESS) {
  const x = Math.max(0, Math.min(1, elapsedRatio));
  const raw = 100 / (1 + Math.exp(-k * (x - 0.5)));
  const rawStart = 100 / (1 + Math.exp(-k * (0 - 0.5)));
  const rawEnd = 100 / (1 + Math.exp(-k * (1 - 0.5)));
  const scaled = 2 + ((raw - rawStart) / (rawEnd - rawStart)) * 96;
  return Math.round(Math.max(0, Math.min(100, scaled)));
}

function buildSyntheticMonths() {
  const dateList = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    dateList.push(d.toLocaleString('en-US', { month: 'short' }));
  }
  return { monthKeys: [], months: dateList };
}

function interpolatePlanned(stepCount) {
  if (stepCount <= 1) return [SIGMOIDAL_PLANNED[0]];
  return Array.from({ length: stepCount }, (_, idx) => {
    const srcIdx = Math.round((idx / (stepCount - 1)) * (SIGMOIDAL_PLANNED.length - 1));
    return SIGMOIDAL_PLANNED[srcIdx];
  });
}

function getScheduleEntries(activeData, projects, selectedWo) {
  const entries = [];
  const woSet = new Set();

  const addEntry = (wo, start, end) => {
    if (!wo || woSet.has(wo)) return;
    woSet.add(wo);
    entries.push({
      work_order_no: wo,
      project_start_date: start || null,
      project_end_date: end || null
    });
  };

  if (selectedWo !== 'all') {
    const fromCurve = (activeData || []).find((d) => d.work_order_no === selectedWo);
    const fromProject = (projects || []).find((p) => p.work_order_no === selectedWo);
    addEntry(
      selectedWo,
      fromCurve?.project_start_date || fromProject?.project_start_date,
      fromCurve?.project_end_date || fromProject?.project_end_date
    );
    return entries;
  }

  (projects || []).forEach((p) => addEntry(p.work_order_no, p.project_start_date, p.project_end_date));
  (activeData || []).forEach((d) => addEntry(d.work_order_no, d.project_start_date, d.project_end_date));
  return entries;
}

function plannedAtMonthKey(monthKey, scheduleEntry) {
  const start = parseLocalDate(scheduleEntry.project_start_date);
  const end = parseLocalDate(scheduleEntry.project_end_date);
  const mid = monthMidpoint(monthKey);
  if (!start || !end || !mid) return null;

  const totalMs = end.getTime() - start.getTime();
  if (totalMs <= 0) return null;

  const elapsedMs = mid.getTime() - start.getTime();
  return plannedPctAtElapsed(elapsedMs / totalMs);
}

function buildPlannedSeries(monthKeys, activeData, projects, selectedWo) {
  const schedules = getScheduleEntries(activeData, projects, selectedWo);
  const validSchedules = schedules.filter((s) =>
    isValidProjectWindow(s.project_start_date, s.project_end_date)
  );

  if (!validSchedules.length || !monthKeys?.length) {
    return {
      planned: interpolatePlanned(monthKeys?.length || SIGMOIDAL_PLANNED.length),
      isDefaultPlannedCurve: true,
      plannedSource: 'generic_sigmoid',
      datedProjectCount: 0,
      totalProjectCount: schedules.length,
      partialScheduleCoverage: schedules.length > 0
    };
  }

  const planned = monthKeys.map((monthKey) => {
    const vals = validSchedules
      .map((s) => plannedAtMonthKey(monthKey, s))
      .filter((v) => v !== null);
    if (!vals.length) return 0;
    return Math.round(vals.reduce((sum, v) => sum + v, 0) / vals.length);
  });

  return {
    planned,
    isDefaultPlannedCurve: false,
    plannedSource: 'contract_dates',
    datedProjectCount: validSchedules.length,
    totalProjectCount: schedules.length,
    partialScheduleCoverage: validSchedules.length < schedules.length
  };
}

function buildContractMonthKeys(schedules) {
  const valid = schedules.filter((s) =>
    isValidProjectWindow(s.project_start_date, s.project_end_date)
  );
  if (!valid.length) return null;

  let minStart = null;
  let maxEnd = null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  valid.forEach((s) => {
    const start = parseLocalDate(s.project_start_date);
    const end = parseLocalDate(s.project_end_date);
    const effectiveEnd = end < today ? end : today;
    if (!minStart || start < minStart) minStart = start;
    if (!maxEnd || effectiveEnd > maxEnd) maxEnd = effectiveEnd;
  });

  if (!minStart || !maxEnd || maxEnd < minStart) return null;

  const keys = [];
  const cursor = new Date(minStart.getFullYear(), minStart.getMonth(), 1);
  const endMonth = new Date(maxEnd.getFullYear(), maxEnd.getMonth(), 1);
  while (cursor <= endMonth) {
    keys.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return keys.slice(-6);
}

function averageProgress(projects, selectedWo) {
  const activeProjects =
    selectedWo === 'all'
      ? projects
      : (projects || []).filter((p) => p.work_order_no === selectedWo);

  if (!activeProjects?.length) return 0;
  return Math.round(
    activeProjects.reduce((a, p) => a + Number(p.physical_progress || 0), 0) / activeProjects.length
  );
}

function buildSyntheticActual(monthCount, avgProg) {
  return Array.from({ length: monthCount }, (_, idx) => {
    const factor = (idx + 1) / monthCount;
    return Math.min(100, Math.round(avgProg * Math.pow(factor, 1.2)));
  });
}

function buildRealSeries(activeData) {
  const monthBuckets = {};
  let totalPoints = 0;

  activeData.forEach(({ work_order_no, actuals }) => {
    (actuals || []).forEach(({ date, progress }) => {
      if (!date) return;
      totalPoints += 1;
      const monthKey = date.slice(0, 7);
      if (!monthBuckets[monthKey]) monthBuckets[monthKey] = {};
      const prog = Number(progress || 0);
      monthBuckets[monthKey][work_order_no] = Math.max(monthBuckets[monthKey][work_order_no] ?? -1, prog);
    });
  });

  if (totalPoints < MIN_DPR_POINTS_FOR_REAL_HISTORY) return null;

  const sortedKeys = Object.keys(monthBuckets).sort().slice(-6);
  const months = sortedKeys.map(formatMonthLabel);
  const actual = sortedKeys.map((monthKey) => {
    const vals = Object.values(monthBuckets[monthKey]);
    return Math.round(vals.reduce((sum, v) => sum + v, 0) / vals.length);
  });

  return { monthKeys: sortedKeys, months, actual, dprPointCount: totalPoints };
}

export function computeSCurveSeries(sCurveData = [], projects = [], selectedWo = 'all') {
  const activeData =
    selectedWo === 'all'
      ? sCurveData
      : (sCurveData || []).filter((d) => d.work_order_no === selectedWo);

  const avgProg = averageProgress(projects, selectedWo);
  const realSeries = buildRealSeries(activeData || []);

  if (realSeries) {
    const plannedMeta = buildPlannedSeries(realSeries.monthKeys, activeData, projects, selectedWo);
    return {
      months: realSeries.months,
      planned: plannedMeta.planned,
      actual: realSeries.actual,
      isProjectedTrend: false,
      dprPointCount: realSeries.dprPointCount,
      avgProg,
      isDefaultPlannedCurve: plannedMeta.isDefaultPlannedCurve,
      plannedSource: plannedMeta.plannedSource,
      datedProjectCount: plannedMeta.datedProjectCount,
      totalProjectCount: plannedMeta.totalProjectCount,
      partialScheduleCoverage: plannedMeta.partialScheduleCoverage
    };
  }

  const schedules = getScheduleEntries(activeData, projects, selectedWo);
  const contractMonthKeys = buildContractMonthKeys(schedules);
  const syntheticFallback = buildSyntheticMonths();
  const monthKeys = contractMonthKeys || [];
  const months = contractMonthKeys
    ? contractMonthKeys.map(formatMonthLabel)
    : syntheticFallback.months;
  const plannedMeta = buildPlannedSeries(
    monthKeys.length ? monthKeys : null,
    activeData,
    projects,
    selectedWo
  );

  return {
    months,
    planned: plannedMeta.planned,
    actual: buildSyntheticActual(months.length, avgProg),
    isProjectedTrend: true,
    dprPointCount: (activeData || []).reduce((sum, s) => sum + (s.actuals || []).length, 0),
    avgProg,
    isDefaultPlannedCurve: plannedMeta.isDefaultPlannedCurve,
    plannedSource: plannedMeta.plannedSource,
    datedProjectCount: plannedMeta.datedProjectCount,
    totalProjectCount: plannedMeta.totalProjectCount,
    partialScheduleCoverage: plannedMeta.partialScheduleCoverage
  };
}

// Exported for unit tests
export const _scurveTestUtils = {
  plannedPctAtElapsed,
  isValidProjectWindow,
  buildPlannedSeries,
  getScheduleEntries,
  SIGMOIDAL_PLANNED
};
