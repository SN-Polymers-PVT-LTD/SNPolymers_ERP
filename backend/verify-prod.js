const { Client } = require('pg');
require('dotenv').config({ path: '.env.prod-db' });

const uri = process.env.SUPABASE_TEST_DB_URI;

if (!uri) {
  console.error('Error: SUPABASE_TEST_DB_URI is not set in .env.prod-db');
  process.exit(1);
}

async function verify() {
  const client = new Client({ connectionString: uri });
  try {
    await client.connect();
    console.log('Successfully connected to the Production Database.\n');

    let allPassed = true;

    // 1. Verify table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND table_name = 'estimate_quotations'
      );
    `);
    const tableExists = tableCheck.rows[0].exists;
    console.log(`[${tableExists ? 'PASS' : 'FAIL'}] Table "public.estimate_quotations" exists.`);
    if (!tableExists) allPassed = false;

    // 2. Verify lock function exists
    const functionCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'lock_estimate_quotations'
      );
    `);
    const functionExists = functionCheck.rows[0].exists;
    console.log(`[${functionExists ? 'PASS' : 'FAIL'}] RPC Function "public.lock_estimate_quotations" exists.`);
    if (!functionExists) allPassed = false;

    // 3. Verify trigger exists on the table
    const triggerCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM pg_trigger 
        WHERE tgname = 'trg_audit_estimate_quotations_changes'
      );
    `);
    const triggerExists = triggerCheck.rows[0].exists;
    console.log(`[${triggerExists ? 'PASS' : 'FAIL'}] Trigger "trg_audit_estimate_quotations_changes" exists.`);
    if (!triggerExists) allPassed = false;

    // 4. Verify storage bucket exists in storage.buckets table
    const bucketCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM storage.buckets
        WHERE id = 'estimate-quotations'
      );
    `);
    const bucketExists = bucketCheck.rows[0].exists;
    console.log(`[${bucketExists ? 'PASS' : 'FAIL'}] Storage bucket "estimate-quotations" exists.`);
    if (!bucketExists) allPassed = false;

    // 5. Verify migration log entry exists
    const migrationCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM public._migration_log
        WHERE filename = '020_create_estimate_quotations.sql'
      );
    `);
    const migrationLogged = migrationCheck.rows[0].exists;
    console.log(`[${migrationLogged ? 'PASS' : 'FAIL'}] Migration "020_create_estimate_quotations.sql" logged as applied.`);
    if (!migrationLogged) allPassed = false;

    console.log('\n-------------------------------------------');
    if (allPassed) {
      console.log('🎉 SUCCESS: All migration objects are correctly applied and verified in Production!');
    } else {
      console.log('❌ FAILURE: Some migration objects are missing in Production.');
    }
  } catch (err) {
    console.error('Verification failed with error:', err.message);
  } finally {
    await client.end();
  }
}

verify();
