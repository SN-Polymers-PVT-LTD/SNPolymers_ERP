const { supabase } = require('../src/db/supabase');

async function main() {
  const mobile = '+919555557515';
  const name = 'Test Staff User';
  const role = 'staff';
  const chatId = '99999';

  console.log(`Ensuring staff user ${mobile} exists...`);

  // Check if already exists
  const { data: existing, error: fetchError } = await supabase
    .from('authorised_users')
    .select('*')
    .eq('mobile_number', mobile)
    .maybeSingle();

  if (fetchError) {
    console.error('Error checking existing user:', fetchError.message);
    return;
  }

  if (existing) {
    // Update
    const { data, error } = await supabase
      .from('authorised_users')
      .update({ role, telegram_chat_id: chatId, is_active: true })
      .eq('mobile_number', mobile)
      .select();

    if (error) {
      console.error('Failed to update staff user:', error.message);
    } else {
      console.log('Successfully updated existing staff user:', data[0]);
    }
  } else {
    // Insert
    const { data, error } = await supabase
      .from('authorised_users')
      .insert([{
        mobile_number: mobile,
        display_name: name,
        role: role,
        telegram_chat_id: chatId,
        is_active: true
      }])
      .select();

    if (error) {
      console.error('Failed to insert staff user:', error.message);
    } else {
      console.log('Successfully inserted new staff user:', data[0]);
    }
  }
}

main();
