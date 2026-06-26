const { supabase } = require('./src/db/supabase');
const ESTIMATE_STATUS = require('./src/constants/estimate-status');

const ZO_VISIBLE_STATUSES = [
  ESTIMATE_STATUS.SUBMITTED,
  ESTIMATE_STATUS.UNDER_ZO_REVIEW,
  ESTIMATE_STATUS.ZO_REVISION_REQUESTED,
  ESTIMATE_STATUS.ZO_APPROVED,
  ESTIMATE_STATUS.REJECTED_BY_ZO
];

async function run() {
  // Simulate JE query for Shreyan Ghosh (+918276071523 - admin but let's test JE role check)
  let jeQuery = supabase
    .from('project_cost_estimates')
    .select('estimate_id, estimate_no, estimate_status, created_by', { count: 'exact' })
    .eq('created_by', '+918276071523');

  if (process.env.IDBP_FILTER_TEST_DATA === 'true') {
    jeQuery = jeQuery
      .not('work_order_no', 'like', 'TEST_%')
      .not('estimate_no', 'like', 'EST_%');
  }
  const { data: jeData, count: jeCount, error: jeError } = await jeQuery;
  console.log('JE Query count:', jeCount, 'Error:', jeError);

  // Simulate ZO query
  let zoQuery = supabase
    .from('project_cost_estimates')
    .select('estimate_id, estimate_no, estimate_status, created_by', { count: 'exact' })
    .in('estimate_status', ZO_VISIBLE_STATUSES);

  if (process.env.IDBP_FILTER_TEST_DATA === 'true') {
    zoQuery = zoQuery
      .not('work_order_no', 'like', 'TEST_%')
      .not('estimate_no', 'like', 'EST_%');
  }
  const { data: zoData, count: zoCount, error: zoError } = await zoQuery;
  console.log('ZO Query count:', zoCount, 'Error:', zoError);
  if (zoData) {
    console.log('ZO visible statuses sample:', zoData.slice(0, 5));
  }
}
run();
