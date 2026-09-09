const { supabase } = require('../../src/db/supabase');

async function setupUsers(users) {
  for (const user of users) {
    const { error } = await supabase
      .from('authorised_users')
      .upsert(user, { onConflict: 'mobile_number' });

    if (error) {
      // Fallback: if upsert errors for any reason, attempt direct update
      await supabase
        .from('authorised_users')
        .update({
          role: user.role,
          is_active: user.is_active,
          display_name: user.display_name,
          permissions: user.permissions || {}
        })
        .eq('mobile_number', user.mobile_number);
    }
  }
}

module.exports = setupUsers;
