const { supabase } = require('./src/db/supabase');

async function check() {
  const { data, error } = await supabase
    .from('excess_fund_returns')
    .select('*')
    .limit(1);

  if (error) {
    console.error('Error:', error);
  } else {
    console.log('Sample row:', data);
  }
}
check();
