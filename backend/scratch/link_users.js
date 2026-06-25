const { supabase } = require('../src/db/supabase');

async function main() {
  const usersToLink = [
    { mobile: '+919222227515', chatId: '12345' }, // ZO User
    { mobile: '+919000007515', chatId: '23456' }, // JE User A
    { mobile: '+918276071523', chatId: '34567' }  // Admin (Shreyan Ghosh)
  ];

  for (const item of usersToLink) {
    const { data, error } = await supabase
      .from('authorised_users')
      .update({ telegram_chat_id: item.chatId })
      .eq('mobile_number', item.mobile)
      .select();

    if (error) {
      console.error(`Failed to link ${item.mobile}:`, error.message);
    } else {
      console.log(`Successfully linked ${item.mobile} with chatId ${item.chatId}`);
    }
  }
}

main();
