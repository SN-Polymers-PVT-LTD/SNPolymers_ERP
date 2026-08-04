'use strict';

const { supabase } = require('../db/supabase');

/**
 * Display name resolver helper matching project pattern
 */
async function resolveDisplayNames(mobiles) {
  const uniqueMobiles = Array.from(new Set(mobiles.filter(Boolean)));
  const userMap = {};
  if (uniqueMobiles.length > 0) {
    const { data: users, error } = await supabase
      .from('authorised_users')
      .select('mobile_number, display_name')
      .in('mobile_number', uniqueMobiles);
    if (!error && users) {
      users.forEach(u => {
        userMap[u.mobile_number] = u.display_name;
      });
    }
  }
  return userMap;
}

/**
 * GET /api/v1/auth/estimated-bills
 * Retrieves a list of estimated bills with filtering and role scoping.
 * Aggregates multiple entries per work order into a single overview row per WO.
 */
async function listEstimatedBills(req, res) {
  try {
    const { role, mobile_number } = req.user;
    const query = req.query || {};

    let dbQuery = supabase
      .from('estimated_bills')
      .select('*, projects_master!inner(zone, department, state, district, site_details, work_order_value, zo_user_id, status)');

    if (query.status === 'all') {
      // Return all status categories without filtering
    } else if (query.status) {
      dbQuery = dbQuery.eq('projects_master.status', query.status.trim());
    } else {
      // Default to Running (Active) contracts
      dbQuery = dbQuery.eq('projects_master.status', 'Running');
    }

    if (role === 'zo') {
      dbQuery = dbQuery.eq('projects_master.zo_user_id', mobile_number);
    }

    if (query.zone) {
      dbQuery = dbQuery.eq('projects_master.zone', query.zone.trim());
    }
    if (query.work_order_no) {
      dbQuery = dbQuery.eq('work_order_no', query.work_order_no.trim());
    }
    if (query.min_surety) {
      dbQuery = dbQuery.gte('surety_pct', Number(query.min_surety));
    }
    if (query.payment_date_from) {
      dbQuery = dbQuery.gte('estimated_payment_date', query.payment_date_from.trim());
    }
    if (query.payment_date_to) {
      dbQuery = dbQuery.lte('estimated_payment_date', query.payment_date_to.trim());
    }

    // Order by created_at to group correctly in timeline order
    const { data: records, error } = await dbQuery.order('created_at', { ascending: true });

    if (error) throw error;

    const enriched = [];
    if (records && records.length > 0) {
      // Group by work_order_no
      const groups = {};
      records.forEach(r => {
        const wo = r.work_order_no;
        if (!groups[wo]) {
          groups[wo] = {
            work_order_no: wo,
            entries: [],
            projects_master: r.projects_master
          };
        }
        groups[wo].entries.push(r);
      });

      // Aggregate each group
      for (const wo of Object.keys(groups)) {
        const g = groups[wo];
        const pm = g.projects_master || {};
        
        // Find latest entry by created_at / updated_at
        let latest = g.entries[0];
        g.entries.forEach(e => {
          if (new Date(e.updated_at) > new Date(latest.updated_at)) {
            latest = e;
          }
        });

        // Resolve user display names for the latest entry
        const userMap = await resolveDisplayNames([latest.created_by, latest.updated_by]);

        const totalAmount = g.entries.reduce((sum, e) => sum + Number(e.estimated_bill_amount || 0), 0);
        // Weighted Average Surety = SUM(amount * surety) / SUM(amount)
        const weightedSuretySum = g.entries.reduce((sum, e) => sum + (Number(e.estimated_bill_amount || 0) * Number(e.surety_pct || 0)), 0);
        const wtdSuretyPct = totalAmount > 0 ? parseFloat((weightedSuretySum / totalAmount).toFixed(1)) : 0;
        const suretyAmount = g.entries.reduce((sum, e) => sum + (Number(e.estimated_bill_amount || 0) * Number(e.surety_pct || 0) / 100), 0);

        enriched.push({
          id: latest.id,
          work_order_no: wo,
          estimated_bill_amount: totalAmount,
          surety_pct: wtdSuretyPct,
          surety_amount: suretyAmount,
          entry_count: g.entries.length,
          remarks: latest.remarks,
          created_by: latest.created_by,
          created_by_name: userMap[latest.created_by] || latest.created_by,
          created_at: latest.created_at,
          updated_by: latest.updated_by,
          updated_by_name: userMap[latest.updated_by] || latest.updated_by,
          updated_at: latest.updated_at,
          status: pm.status || 'Running',
          zone: pm.zone,
          department: pm.department,
          state: pm.state,
          district: pm.district,
          site_details: pm.site_details,
          work_order_value: pm.work_order_value ? Number(pm.work_order_value) : null
        });
      }
    }

    return res.status(200).json({
      success: true,
      data: enriched
    });

  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('listEstimatedBills failed:', error);
    } else {
      console.error(`listEstimatedBills failed: ${error.message}`);
    }
    return res.status(500).json({ success: false, message: 'Failed to retrieve estimated bills.' });
  }
}

/**
 * GET /api/v1/auth/estimated-bills/work-orders
 * Retrieves available Work Orders scoped by caller role for dropdown picker.
 */
async function listWorkOrderOptions(req, res) {
  try {
    const { role, mobile_number } = req.user;
    const query = req.query || {};

    let dbQuery = supabase
      .from('eligible_estimated_bill_work_orders')
      .select('work_order_no, estimate_no, state, district, zone, department, site_details, work_order_value, zo_user_id, status');

    if (role === 'zo') {
      dbQuery = dbQuery.eq('zo_user_id', mobile_number);
    }

    const { data: projects, error } = await dbQuery.order('work_order_no', { ascending: true });

    if (error) throw error;

    const options = (projects || []).map(p => ({
      work_order_no: p.work_order_no,
      estimate_no: p.estimate_no,
      state: p.state,
      district: p.district,
      zone: p.zone,
      department: p.department,
      site_details: p.site_details,
      work_order_value: p.work_order_value ? Number(p.work_order_value) : 0,
      label: `${p.work_order_no} — ${p.site_details || p.department}`
    }));

    return res.status(200).json({
      success: true,
      workOrders: options
    });

  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('listWorkOrderOptions failed:', error);
    } else {
      console.error(`listWorkOrderOptions failed: ${error.message}`);
    }
    return res.status(500).json({ success: false, message: 'Failed to retrieve work order options.' });
  }
}

/**
 * GET /api/v1/auth/estimated-bills/:work_order_no
 * Retrieves all timeline entries for a specific Work Order (with ZO scoping check).
 */
async function getEstimatedBill(req, res) {
  try {
    const { work_order_no } = req.params;
    const { role, mobile_number } = req.user;

    // Check project master existence and ZO scoping
    const { data: project, error: projErr } = await supabase
      .from('projects_master')
      .select('work_order_no, state, district, zone, department, site_details, work_order_value, zo_user_id, status')
      .eq('work_order_no', work_order_no.trim())
      .maybeSingle();

    if (projErr) throw projErr;
    if (!project) {
      return res.status(404).json({ success: false, message: 'Work order not found.' });
    }

    if (role === 'zo' && project.zo_user_id !== mobile_number) {
      return res.status(404).json({ success: false, message: 'Work order not found.' });
    }

    // Check if Final Bill already exists
    const { data: finalBill, error: fbErr } = await supabase
      .from('ra_final_bills')
      .select('bill_id')
      .eq('work_order_no', work_order_no.trim())
      .eq('payment_type', 'Final Bill')
      .maybeSingle();

    if (fbErr) throw fbErr;

    // Retrieve all timeline entries for this work order ordered by created_at DESC
    const { data: records, error: recErr } = await supabase
      .from('estimated_bills')
      .select('*')
      .eq('work_order_no', work_order_no.trim())
      .order('created_at', { ascending: false });

    if (recErr) throw recErr;

    const enriched = [];
    if (records && records.length > 0) {
      const mobiles = [];
      records.forEach(r => {
        mobiles.push(r.created_by);
        mobiles.push(r.updated_by);
      });
      const userMap = await resolveDisplayNames(mobiles);

      records.forEach(r => {
        enriched.push({
          id: r.id,
          work_order_no: r.work_order_no,
          estimated_bill_amount: Number(r.estimated_bill_amount),
          estimated_payment_date: r.estimated_payment_date,
          surety_pct: r.surety_pct,
          remarks: r.remarks,
          created_by: r.created_by,
          created_by_name: userMap[r.created_by] || r.created_by,
          created_at: r.created_at,
          updated_by: r.updated_by,
          updated_by_name: userMap[r.updated_by] || r.updated_by,
          updated_at: r.updated_at,
          zone: project.zone,
          department: project.department,
          state: project.state,
          district: project.district,
          site_details: project.site_details,
          work_order_value: project.work_order_value ? Number(project.work_order_value) : null
        });
      });
    }

    return res.status(200).json({
      success: true,
      data: enriched,
      project: {
        work_order_no: project.work_order_no,
        zone: project.zone,
        department: project.department,
        state: project.state,
        district: project.district,
        site_details: project.site_details,
        work_order_value: project.work_order_value ? Number(project.work_order_value) : null,
        status: project.status,
        final_bill_exists: !!finalBill
      }
    });

  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('getEstimatedBill failed:', error);
    } else {
      console.error(`getEstimatedBill failed: ${error.message}`);
    }
    return res.status(500).json({ success: false, message: 'Failed to retrieve estimated bill ledger.' });
  }
}

/**
 * POST /api/v1/auth/estimated-bills
 * Performs append-only insert of an estimated bill record using transactional RPC.
 */
async function upsertEstimatedBill(req, res) {
  try {
    const { role, mobile_number } = req.user;
    const { work_order_no, estimated_bill_amount, estimated_payment_date, surety_pct, remarks } = req.body;

    // Authorization guard: ZO may only write within their assigned zone
    if (role === 'zo') {
      const { data: wo, error: woErr } = await supabase
        .from('projects_master')
        .select('zo_user_id')
        .eq('work_order_no', work_order_no.trim())
        .maybeSingle();

      if (woErr) throw woErr;
      if (!wo || wo.zo_user_id !== mobile_number) {
        return res.status(403).json({ success: false, message: 'Work order not in your zone.' });
      }
    }

    const { data: result, error: rpcError } = await supabase.rpc('insert_estimated_bill', {
      p_work_order_no: work_order_no.trim(),
      p_amount: Number(estimated_bill_amount),
      p_estimated_date: estimated_payment_date.trim(),
      p_surety_pct: Number(surety_pct),
      p_remarks: remarks?.trim() || null,
      p_actor: mobile_number
    });

    if (rpcError) {
      if (rpcError.message && (
        rpcError.message.includes('cannot exceed work order value') ||
        rpcError.message.includes('must be greater than zero') ||
        rpcError.message.includes('between 0 and 100') ||
        rpcError.message.includes('not found') ||
        rpcError.message.includes('only be created for Running') ||
        rpcError.message.includes('after a Final Bill has been submitted')
      )) {
        return res.status(400).json({ success: false, message: rpcError.message });
      }
      throw rpcError;
    }

    return res.status(200).json({
      success: true,
      data: result,
      message: 'Estimated bill saved successfully.'
    });

  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('upsertEstimatedBill failed:', error);
    } else {
      console.error(`upsertEstimatedBill failed: ${error.message}`);
    }
    return res.status(500).json({ success: false, message: 'Failed to save estimated bill.' });
  }
}

module.exports = {
  listEstimatedBills,
  listWorkOrderOptions,
  getEstimatedBill,
  upsertEstimatedBill
};
