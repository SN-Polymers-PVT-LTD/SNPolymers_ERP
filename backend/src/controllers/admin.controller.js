const { supabase } = require('../db/supabase');

/**
 * GET /api/v1/auth/admin/users
 * Lists all authorised users with status
 */
async function getUsers(req, res) {
  try {
    const { data: users, error } = await supabase
      .from('user_login_stats')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return res.status(200).json({ success: true, users });
  } catch (error) {
    console.error(`Admin getUsers failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve whitelisted users.' });
  }
}

/**
 * POST /api/v1/auth/admin/users
 * Adds a new authorised mobile number
 */
async function addUser(req, res) {
  const { mobileNumber, displayName, role, permissions, telegramChatId } = req.body;

  if (!mobileNumber) {
    return res.status(400).json({ success: false, message: 'Mobile number is required.' });
  }

  // Format validation
  const phoneRegex = /^\+?[1-9]\d{1,14}$/;
  if (!phoneRegex.test(mobileNumber)) {
    return res.status(400).json({ success: false, message: 'Invalid mobile number format.' });
  }

  const ALLOWED_ROLES = ['admin', 'je', 'zo', 'ho'];
  if (role !== undefined && !ALLOWED_ROLES.includes(role)) {
    return res.status(400).json({
      success: false,
      message: `Invalid role. Allowed values: ${ALLOWED_ROLES.join(', ')}.`
    });
  }

  try {
    const { data, error } = await supabase
      .from('authorised_users')
      .insert([
        {
          mobile_number: mobileNumber,
          display_name: displayName || null,
          role: role || 'je',
          permissions: permissions || {},
          is_active: true,
          telegram_chat_id: telegramChatId || null
        }
      ])
      .select()
      .single();

    if (error) {
      if (error.code === '23505') { // Postgres duplicate key violation code
        return res.status(409).json({ success: false, message: 'This mobile number is already whitelisted.' });
      }
      throw error;
    }

    return res.status(201).json({ success: true, user: data, message: 'User whitelisted successfully.' });
  } catch (error) {
    console.error(`Admin addUser failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to whitelist user.' });
  }
}

/**
 * PATCH /api/v1/auth/admin/users/:id
 * Updates user details or active status
 */
async function updateUser(req, res) {
  const { id } = req.params;
  const { displayName, role, permissions, isActive, telegramChatId } = req.body;

  const ALLOWED_ROLES = ['admin', 'je', 'zo', 'ho'];
  if (role !== undefined && !ALLOWED_ROLES.includes(role)) {
    return res.status(400).json({
      success: false,
      message: `Invalid role. Allowed values: ${ALLOWED_ROLES.join(', ')}.`
    });
  }

  const updateFields = {};
  if (displayName !== undefined) updateFields.display_name = displayName;
  if (role !== undefined) updateFields.role = role;
  if (permissions !== undefined) updateFields.permissions = permissions;
  if (isActive !== undefined) updateFields.is_active = isActive;
  // Allow explicit null to clear the Telegram link (user switched accounts)
  if (telegramChatId !== undefined) updateFields.telegram_chat_id = telegramChatId;

  try {
    const { data, error } = await supabase
      .from('authorised_users')
      .update(updateFields)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // If deactivated, invalidate all their active sessions
    if (isActive === false) {
      await supabase
        .from('sessions')
        .update({ is_active: false, logout_at: new Date().toISOString() })
        .eq('user_id', id)
        .eq('is_active', true);
    }

    return res.status(200).json({ success: true, user: data, message: 'User updated successfully.' });
  } catch (error) {
    console.error(`Admin updateUser failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to update user.' });
  }
}

/**
 * DELETE /api/v1/auth/admin/users/:id
 * Removes user and invalidates all sessions
 */
async function removeUser(req, res) {
  const { id } = req.params;

  try {
    // 0. Pre-check: block deletion if user has active resource associations
    const { data: userRecord } = await supabase
      .from('authorised_users')
      .select('mobile_number')
      .eq('id', id)
      .maybeSingle();

    if (userRecord) {
      // Check for active estimates
      const { count: estimateCount, error: estErr } = await supabase
        .from('project_cost_estimates')
        .select('estimate_id', { count: 'exact', head: true })
        .eq('created_by', userRecord.mobile_number);

      if (estErr) throw estErr;
      if (estimateCount > 0) {
        return res.status(409).json({
          success: false,
          message: `Cannot delete user: they have ${estimateCount} cost estimate(s). Deactivate the user instead.`
        });
      }

      // Check for active fund requests
      const { count: frCount, error: frErr } = await supabase
        .from('fund_requests')
        .select('fund_request_id', { count: 'exact', head: true })
        .eq('zo_user_id', userRecord.mobile_number)
        .eq('request_status', 'Pending');

      if (frErr) throw frErr;
      if (frCount > 0) {
        return res.status(409).json({
          success: false,
          message: `Cannot delete user: they have ${frCount} pending fund request(s). Cancel them first.`
        });
      }

      // Check for active pending requisitions (SEC-5)
      const { count: reqCount, error: reqErr } = await supabase
        .from('requisitions')
        .select('requisition_id', { count: 'exact', head: true })
        .eq('requester_user_id', userRecord.mobile_number)
        .eq('requisition_status', 'Pending');

      if (reqErr) throw reqErr;
      if (reqCount > 0) {
        return res.status(409).json({
          success: false,
          message: `Cannot delete user: they have ${reqCount} pending requisition(s). Cancel them first.`
        });
      }

      // Check for daily progress reports (TD-P5-A & TD-P5-B)
      const { count: dpCreatedCount, error: dpCreatedErr } = await supabase
        .from('daily_progress_reports')
        .select('report_id', { count: 'exact', head: true })
        .eq('created_by', userRecord.mobile_number);

      if (dpCreatedErr) {
        if (dpCreatedErr.code !== '42P01') { // Catch postgres undefined_table error code
          throw dpCreatedErr;
        }
      } else if (dpCreatedCount > 0) {
        return res.status(409).json({
          success: false,
          message: `Cannot delete user: they have submitted ${dpCreatedCount} daily progress report(s). Deactivate the user instead.`
        });
      }

      const { count: dpApprovedCount, error: dpApprovedErr } = await supabase
        .from('daily_progress_reports')
        .select('report_id', { count: 'exact', head: true })
        .eq('approved_user_id', userRecord.mobile_number);

      if (dpApprovedErr) {
        if (dpApprovedErr.code !== '42P01') {
          throw dpApprovedErr;
        }
      } else if (dpApprovedCount > 0) {
        return res.status(409).json({
          success: false,
          message: `Cannot delete user: they have approved/signed remarks on ${dpApprovedCount} daily progress report(s). Deactivate the user instead.`
        });
      }
    }

    // 1. Invalidate active sessions first
    await supabase
      .from('sessions')
      .update({ is_active: false, logout_at: new Date().toISOString() })
      .eq('user_id', id)
      .eq('is_active', true);

    // 2. Perform delete
    const { error } = await supabase
      .from('authorised_users')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return res.status(200).json({ success: true, message: 'User removed from whitelist and sessions invalidated.' });
  } catch (error) {
    console.error(`Admin removeUser failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to remove user.' });
  }
}

/**
 * GET /api/v1/auth/admin/sessions
 * Full session audit log with optional filter queries
 */
async function getSessions(req, res) {
  const reqQuery = req.query || {};
  const { userId, dateFrom, dateTo } = reqQuery;

  try {
    const hasPagination = reqQuery.page !== undefined || reqQuery.limit !== undefined;

    if (!hasPagination) {
      let query = supabase
        .from('sessions')
        .select(`
          *,
          authorised_users (
            mobile_number,
            display_name,
            role
          )
        `)
        .order('login_at', { ascending: false });

      if (userId) {
        query = query.eq('user_id', userId);
      }
      if (dateFrom) {
        query = query.gte('login_at', new Date(dateFrom).toISOString());
      }
      if (dateTo) {
        query = query.lte('login_at', new Date(dateTo).toISOString());
      }

      const { data: sessions, error } = await query;
      if (error) throw error;
      return res.status(200).json({ success: true, sessions });
    }

    // Paginated flow
    const page = parseInt(reqQuery.page) || 1;
    const limit = Math.min(parseInt(reqQuery.limit || 50), 100);
    const offset = (page - 1) * limit;

    let query = supabase
      .from('sessions')
      .select(`
        *,
        authorised_users (
          mobile_number,
          display_name,
          role
        )
      `, { count: 'exact' })
      .order('login_at', { ascending: false });

    if (userId) {
      query = query.eq('user_id', userId);
    }
    if (dateFrom) {
      query = query.gte('login_at', new Date(dateFrom).toISOString());
    }
    if (dateTo) {
      query = query.lte('login_at', new Date(dateTo).toISOString());
    }

    query = query.range(offset, offset + limit - 1);

    const { data: sessions, count, error } = await query;
    if (error) throw error;

    return res.status(200).json({
      success: true,
      sessions,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error) {
    console.error(`Admin getSessions failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to fetch session audit logs.' });
  }
}

module.exports = {
  getUsers,
  addUser,
  updateUser,
  removeUser,
  getSessions
};
