const { createClient } = require('@supabase/supabase-js');

// Load .env for app runtime; integration tests pin local Supabase via vitest.config / test-local.sh
require('dotenv').config();

const LOCAL_TEST_SUPABASE_URL = 'http://127.0.0.1:54321';
const LOCAL_TEST_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

// Never let remote .env Supabase credentials leak into Vitest — always use local Docker stack
const supabaseUrl =
  process.env.NODE_ENV === 'test' ? LOCAL_TEST_SUPABASE_URL : process.env.SUPABASE_URL;
const supabaseServiceKey =
  process.env.NODE_ENV === 'test'
    ? LOCAL_TEST_SERVICE_ROLE_KEY
    : process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn(
    'WARNING: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing from environment. Database connection will fail.'
  );
}

// Initialise Supabase client using the service role key to bypass RLS policies on server-side requests
const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseServiceKey || 'placeholder');

module.exports = { supabase };
