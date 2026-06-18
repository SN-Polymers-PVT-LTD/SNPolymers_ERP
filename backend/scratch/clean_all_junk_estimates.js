const { supabase } = require('../src/db/supabase');

const LEGIT_ESTIMATES = ['COB_4', 'GYA_2', 'ANG_1', 'BAL_2', 'BAN_2'];
const TEMP_WO = 'TEST_WO_DELETE';

async function cleanJunkEstimates() {
  console.log('Starting cleanup of junk estimates from previous test runs...');

  try {
    // 1. Create a temporary project starting with TEST_WO_ to satisfy foreign keys
    console.log(`Inserting temporary project ${TEMP_WO}...`);
    const { error: projErr } = await supabase.from('projects_master').upsert({
      work_order_no: TEMP_WO,
      estimate_no: 'EST_TEMP_DELETE_HOLDER',
      work_order_value: 1000.00,
      site_details: 'Delete Holder',
      state: 'West Bengal',
      district: 'Kolkata',
      zone: 'Kolkata Zone',
      department: 'PWD',
      status: 'Running',
      created_by: '+918276071523',
      edited_by: '+918276071523'
    });

    if (projErr) throw projErr;

    // 2. Fetch all estimates
    const { data: estimates, error: estErr } = await supabase
      .from('project_cost_estimates')
      .select('estimate_id, estimate_no');
    
    if (estErr) throw estErr;

    const junkEstimateIds = estimates
      .filter(e => !LEGIT_ESTIMATES.includes(e.estimate_no))
      .map(e => e.estimate_id);

    console.log(`Found ${junkEstimateIds.length} junk estimates to delete.`);

    if (junkEstimateIds.length > 0) {
      // Delete estimate items in batches
      const { data: items } = await supabase
        .from('project_cost_estimate_items')
        .select('item_id')
        .in('estimate_id', junkEstimateIds);
      
      if (items && items.length > 0) {
        const itemIds = items.map(it => it.item_id);
        console.log(`Deleting ${itemIds.length} estimate items...`);
        for (let i = 0; i < itemIds.length; i += 100) {
          await supabase.from('project_cost_estimate_items').delete().in('item_id', itemIds.slice(i, i + 100));
        }
      }

      // Delete revision logs
      console.log('Deleting revision logs...');
      for (let i = 0; i < junkEstimateIds.length; i += 100) {
        await supabase.from('estimate_revision_log').delete().in('estimate_id', junkEstimateIds.slice(i, i + 100));
      }

      // Update estimate headers to the temporary TEST_WO_ project
      console.log('Updating estimates to point to temporary test project...');
      for (let i = 0; i < junkEstimateIds.length; i += 100) {
        const { error: updErr } = await supabase.from('project_cost_estimates')
          .update({ work_order_no: TEMP_WO })
          .in('estimate_id', junkEstimateIds.slice(i, i + 100));
        if (updErr) console.warn('Error updating estimates batch:', updErr.message);
      }

      // Delete the estimates (since their work_order_no starts with TEST_WO_, the trigger will allow deletion)
      console.log('Deleting estimate headers...');
      for (let i = 0; i < junkEstimateIds.length; i += 100) {
        const { error: delErr } = await supabase
          .from('project_cost_estimates')
          .delete()
          .in('estimate_id', junkEstimateIds.slice(i, i + 100));
        if (delErr) {
          console.warn('Error deleting estimates batch:', delErr.message);
        }
      }
    }

    // 3. Delete the temporary project
    console.log(`Deleting temporary project ${TEMP_WO}...`);
    await supabase.from('projects_master').delete().eq('work_order_no', TEMP_WO);

    console.log('Junk estimates cleanup completed successfully.');
  } catch (err) {
    console.error('Cleanup failed:', err.message);
  }
}

cleanJunkEstimates();
