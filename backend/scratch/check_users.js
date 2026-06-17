const { supabase } = require('../src/db/supabase');

async function check() {
  const { data: users, error } = await supabase.from('authorised_users').select('*');
  if (error) {
    console.error('Error fetching users:', error);
  } else {
    console.log('Whitelisted Users:');
    users.forEach(u => {
      console.log(`- Mob: ${u.mobile_number}, Name: ${u.display_name}, Role: ${u.role}, Active: ${u.is_active}`);
    });
  }
}

check();
