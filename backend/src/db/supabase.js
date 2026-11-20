const { createClient } = require('@supabase/supabase-js');

// Load .env for app runtime; integration tests pin local Supabase via vitest.config / test-local.sh
require('dotenv').config();

const { getLocalTestTarget } = require('../config/localTestTarget');
const localTarget = process.env.NODE_ENV === 'test' ? getLocalTestTarget() : null;

// Never let remote .env Supabase credentials leak into Vitest — always use local Docker stack unless USE_DEV_DB is explicitly set
const supabaseUrl =
  process.env.USE_DEV_DB === 'true' && process.env.SUPABASE_URL
    ? process.env.SUPABASE_URL
    : (process.env.NODE_ENV === 'test' ? localTarget.apiUrl : process.env.SUPABASE_URL);
const supabaseServiceKey =
  process.env.USE_DEV_DB === 'true' && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? process.env.SUPABASE_SERVICE_ROLE_KEY
    : (process.env.NODE_ENV === 'test'
        ? localTarget.serviceRoleKey
        : process.env.SUPABASE_SERVICE_ROLE_KEY);

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn(
    'WARNING: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing from environment. Database connection will fail.'
  );
}

// Initialise Supabase client using the service role key to bypass RLS policies on server-side requests
const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseServiceKey || 'placeholder');

module.exports = { supabase };
