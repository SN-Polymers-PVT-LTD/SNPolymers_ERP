// seed_purchase_list.js
// Run from the project root or backend directory to insert the Purchase List master data
// Ensure the backend .env is loaded (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌  SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const purchaseList = [
  'Purchase List',
  'Purchase from Area Office',
  'Purchase from Head Office',
  'Central Store Issue',
  'Area Store Issue',
  'Direct Vendor Purchase',
  'Project Site Purchase',
  'Inter‑Office Transfer',
  'Emergency Purchase',
  'To Be Decided / On Hold',
];

async function seed() {
  console.log('🚀  Seeding purchase_data table...');
  const { data, error } = await supabase.from('purchase_data').insert(
    purchaseList.map(name => ({ name, is_active: true }))
  ).select();

  if (error) {
    console.error('❌  Seed failed:', error.message);
    process.exit(1);
  }

  console.log('✅  Seed successful. Inserted rows:');
  data.forEach(row => console.log(` • ${row.id} – ${row.name}`));
}

seed();
