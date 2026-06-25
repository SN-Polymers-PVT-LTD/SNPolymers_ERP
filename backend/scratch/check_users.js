const { supabase } = require('../src/db/supabase');

async function main() {
  const { data, error } = await supabase
    .from('authorised_users')
    .select('mobile_number, display_name, role, is_active');
  
  console.log('Authorised users:', data);
  console.log('Error:', error);
}

main();
