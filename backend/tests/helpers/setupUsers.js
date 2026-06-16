const { supabase } = require('../../src/db/supabase');

async function setupUsers(users) {
  const mobileNumbers = users.map(u => u.mobile_number);
  const { error: delErr } = await supabase
    .from('authorised_users')
    .delete()
    .in('mobile_number', mobileNumbers);
  
  if (delErr) {
    // If delete fails due to active references, it's ok, we try inserting/updating
  }

  const { error: insErr } = await supabase
    .from('authorised_users')
    .insert(users);

  if (insErr) {
    // If insert fails (e.g. key already exists), try updating roles/is_active
    for (const user of users) {
      await supabase
        .from('authorised_users')
        .update({ role: user.role, is_active: user.is_active, display_name: user.display_name })
        .eq('mobile_number', user.mobile_number);
    }
  }
}

module.exports = setupUsers;
