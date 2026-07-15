'use strict';

const { supabase } = require('../db/supabase');
const { executeReconciliation } = require('../services/reconciliation.service');

// Display name resolver helper
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
 * GET /api/v1/auth/zo-balances
 * Retrieves Zonal Office credit balances.
 */
async function getZonalBalances(req, res) {
  try {
    const query = req.query || {};

    if (query.work_order_no) {
      const zoId = req.user.role === 'zo' ? req.user.mobile_number : query.zo_user_id;
      if (!zoId) {
        return res.status(400).json({ success: false, message: 'zo_user_id is required.' });
      }

      const { data: ledgerSum, error: ledgerErr } = await supabase
        .from('zo_fund_ledger')
        .select('amount')
        .eq('zo_user_id', zoId)
        .eq('work_order_no', query.work_order_no);

      if (ledgerErr) throw ledgerErr;

      const sum = (ledgerSum || []).reduce((acc, curr) => acc + Number(curr.amount || 0), 0);

      const userMap = await resolveDisplayNames([zoId]);

      return res.status(200).json({
        success: true,
        balances: [
          {
            zo_user_id: zoId,
            zo_name: userMap[zoId] || zoId,
            available_balance: sum,
            updated_at: new Date().toISOString()
          }
        ]
      });
    }

    let dbQuery = supabase
      .from('zo_balances')
      .select('*');

    if (req.user.role === 'zo') {
      dbQuery = dbQuery.eq('zo_user_id', req.user.mobile_number);
    }

    const { data: balances, error } = await dbQuery.order('zo_user_id', { ascending: true });

    if (error) throw error;

    const enriched = [];
    if (balances && balances.length > 0) {
      const mobiles = balances.map(b => b.zo_user_id);
      const userMap = await resolveDisplayNames(mobiles);

      balances.forEach(b => {
        enriched.push({
          ...b,
          zo_name: userMap[b.zo_user_id] || b.zo_user_id
        });
      });
    }

    return res.status(200).json({
      success: true,
      balances: enriched
    });

  } catch (error) {
    console.error(`getZonalBalances failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve zonal balances.' });
  }
}

/**
 * GET /api/v1/auth/zo-balances/ledger
 * Retrieves paginated transactional history from zo_fund_ledger.
 */
async function getZonalLedger(req, res) {
  try {
    const query = req.query || {};
    const page = Math.max(parseInt(query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit) || 50, 1), 100);
    const offset = (page - 1) * limit;

    let dbQuery = supabase
      .from('zo_fund_ledger')
      .select('*', { count: 'exact' });

    // Enforce role-based access control filters
    if (req.user.role === 'zo') {
      dbQuery = dbQuery.eq('zo_user_id', req.user.mobile_number);
    } else if (query.zo_user_id) {
      dbQuery = dbQuery.eq('zo_user_id', query.zo_user_id);
    }

    if (query.transaction_type) {
      dbQuery = dbQuery.eq('transaction_type', query.transaction_type);
    }

    if (query.reference_type) {
      dbQuery = dbQuery.eq('reference_type', query.reference_type);
    }

    const { data: ledger, count, error } = await dbQuery
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const enriched = [];
    if (ledger && ledger.length > 0) {
      const mobiles = [];
      ledger.forEach(l => {
        mobiles.push(l.zo_user_id);
        mobiles.push(l.created_by);
      });
      const userMap = await resolveDisplayNames(mobiles);

      ledger.forEach(l => {
        enriched.push({
          ...l,
          zo_name: userMap[l.zo_user_id] || l.zo_user_id,
          created_by_name: userMap[l.created_by] || l.created_by
        });
      });
    }

    return res.status(200).json({
      success: true,
      ledger: enriched,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });

  } catch (error) {
    console.error(`getZonalLedger failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve zonal ledger logs.' });
  }
}

/**
 * POST /api/v1/auth/zo-balances/reconcile
 * Triggers manual reconciliation of Zonal Office available balances.
 */
async function reconcileZonalBalances(req, res) {
  try {
    const { zo_user_id } = req.body;

    const data = await executeReconciliation(zo_user_id, req.user.mobile_number);

    return res.status(200).json({
      success: true,
      processed: data.length,
      adjusted: data.filter(d => d.adjusted).length,
      unchanged: data.filter(d => !d.adjusted).length,
      results: data.map(d => ({
        zo_user_id: d.out_zo_user_id,
        old_balance: Number(d.old_balance),
        new_balance: Number(d.new_balance),
        difference: Number(d.difference),
        adjusted: d.adjusted
      }))
    });

  } catch (error) {
    if (error.message && error.message.includes('is not a Zonal Office user')) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error(`reconcileZonalBalances failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to execute zonal balance reconciliation.' });
  }
}

module.exports = {
  getZonalBalances,
  getZonalLedger,
  reconcileZonalBalances
};
