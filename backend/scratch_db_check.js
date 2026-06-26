const { supabase } = require('./src/db/supabase');
async function run() {
  const { data: users, error } = await supabase.from('authorised_users').select('*');
  console.log('Users:', users.map(u => ({ mobile_number: u.mobile_number, role: u.role, display_name: u.display_name })));
}
run();
