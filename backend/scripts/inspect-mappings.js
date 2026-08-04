const { supabase } = require('../src/db/supabase');

async function main() {
  const [jeZoRes, woRes, usersRes] = await Promise.all([
    supabase.from('je_zo_mappings').select('*'),
    supabase.from('work_order_mappings').select('*'),
    supabase.from('authorised_users').select('*')
  ]);

  console.log('\n--- je_zo_mappings ---');
  console.log(jeZoRes.data);

  console.log('\n--- work_order_mappings ---');
  console.log(woRes.data);

  console.log('\n--- authorised_users ---');
  console.log(usersRes.data.map(u => ({ mobile_number: u.mobile_number, display_name: u.display_name, role: u.role, is_active: u.is_active })));
}

main().catch(console.error);
