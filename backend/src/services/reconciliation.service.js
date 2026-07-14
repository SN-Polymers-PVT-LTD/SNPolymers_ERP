const { supabase } = require('../db/supabase');

/**
 * Service: ReconciliationService
 * Executes the database-level reconciliation RPC.
 */
async function executeReconciliation(zoUserId = null, actionedBy = 'SYSTEM') {
  const { data, error } = await supabase.rpc('reconcile_zonal_balances', {
    p_zo_user_id: zoUserId || null,
    p_actioned_by: actionedBy
  });
  if (error) throw error;
  return data;
}

/**
 * Helper: Calculates milliseconds until the next occurrence of target hour & minute.
 */
function msUntilTargetTime(targetHour = 2, targetMinute = 0) {
  const now = new Date();
  const target = new Date();
  target.setHours(targetHour, targetMinute, 0, 0);
  if (now.getTime() >= target.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime() - now.getTime();
}

/**
 * Starts the nightly reconciliation scheduler.
 * @param {number} targetHour – Default is 2 (2:00 AM)
 * @param {number} targetMinute – Default is 0
 * @param {Function} customDelayFn – Optional override for testing
 */
function startReconciliationScheduler(targetHour = 2, targetMinute = 0, customDelayFn = null) {
  console.log(`Reconciliation scheduler registered — 2:00 AM nightly`);

  const runReconciliation = async () => {
    console.log(`[SCHEDULER] Running scheduled nightly zonal balance reconciliation...`);
    const startTime = Date.now();
    try {
      const data = await executeReconciliation(null, 'SYSTEM');
      const duration = Date.now() - startTime;
      console.log(
        `[SCHEDULER] Reconciliation Completed — Processed: ${data.length} ZOs, Corrected: ${
          data.filter(d => d.adjusted).length
        }, Duration: ${duration} ms`
      );
    } catch (err) {
      console.error(`[SCHEDULER] Scheduled reconciliation failed:`, err.message || err);
    } finally {
      // Recursively setup next execution
      scheduleNext();
    }
  };

  const scheduleNext = () => {
    const delay = customDelayFn ? customDelayFn() : msUntilTargetTime(targetHour, targetMinute);
    const hours = (delay / 3600000).toFixed(2);
    console.log(`[SCHEDULER] Zonal Balance Reconciliation scheduled in ${hours} hours.`);
    setTimeout(runReconciliation, delay);
  };

  scheduleNext();
}

module.exports = {
  executeReconciliation,
  startReconciliationScheduler
};
