const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn(
    'WARNING: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing from environment. Database connection will fail.'
  );
}

// Initialise Supabase client using the service role key to bypass RLS policies on server-side requests
const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseServiceKey || 'placeholder');

module.exports = { supabase };
