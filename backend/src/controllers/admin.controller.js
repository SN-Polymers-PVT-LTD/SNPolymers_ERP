const { supabase } = require('../db/supabase');

/**
 * GET /api/v1/auth/admin/users
 * Lists all authorised users with status
 */
async function getUsers(req, res) {
  try {
    const { data: users, error } = await supabase
      .from('authorised_users')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Optional: Get login counts & last login times from sessions for each user
    const { data: sessions, error: sessionErr } = await supabase
      .from('sessions')
      .select('user_id, login_at')
      .order('login_at', { ascending: false });

    if (sessionErr) throw sessionErr;

    const userLoginStats = users.map(user => {
      const userSessions = sessions.filter(s => s.user_id === user.id);
      return {
        ...user,
        session_count: userSessions.length,
        last_login_at: userSessions.length > 0 ? userSessions[0].login_at : null
      };
    });

    return res.status(200).json({ success: true, users: userLoginStats });
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

  try {
    const { data, error } = await supabase
      .from('authorised_users')
      .insert([
        {
          mobile_number: mobileNumber,
          display_name: displayName || null,
          role: role || 'staff',
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
  const { userId, dateFrom, dateTo } = req.query;

  try {
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
