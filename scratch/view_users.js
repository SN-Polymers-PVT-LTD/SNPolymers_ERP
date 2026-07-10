require('dotenv').config({ path: require('path').resolve(__dirname, '../backend/.env') });
const { supabase } = require('../backend/src/db/supabase');

async function checkUsers() {
  const { data, error } = await supabase.from('authorised_users').select('*');
  if (error) {
    console.error('Error fetching users:', error);
  } else {
    console.log('Users in database:');
    data.forEach(user => {
      console.log(`ID: ${user.id}, Display Name: ${user.display_name}, Phone: ${user.mobile_number}, Telegram Chat ID: ${user.telegram_chat_id}, Active: ${user.is_active}`);
    });
  }
}

checkUsers();
