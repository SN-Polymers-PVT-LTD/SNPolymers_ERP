#!/usr/bin/env node
// Explicit environment rollout action; structural migrations keep approval off.
const { createPgClient } = require('./lib/pg-connect');
async function main() {
 const mode = process.argv[2];
 if (!['--enable', '--disable'].includes(mode) || process.argv.length !== 3) throw new Error('Usage: set-payroll-financial-activation.js --enable|--disable');
 if (!process.env.SUPABASE_TEST_DB_URI) throw new Error('Target database URI is required');
 const enabled = mode === '--enable';
 const client = await createPgClient(process.env.SUPABASE_TEST_DB_URI);
 await client.connect();
 try {
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL statement_timeout='30s'");
  const { rows } = await client.query("SELECT EXISTS(SELECT 1 FROM public._migration_log WHERE filename='173_payroll_accounts_recipient_readiness.sql') AS ready");
  if (enabled && !rows[0].ready) throw new Error('Apply payroll migrations through 173 before activation');
  await client.query(`CREATE OR REPLACE FUNCTION public.payroll_financial_enabled() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT ${enabled ? 'true' : 'false'} $$`);
  await client.query('REVOKE ALL ON FUNCTION public.payroll_financial_enabled() FROM PUBLIC,anon,authenticated,service_role');
  const result = await client.query('SELECT public.payroll_financial_enabled() AS enabled');
  if (result.rows[0].enabled !== enabled) throw new Error('Activation verification failed');
  await client.query('COMMIT');
  console.log(`Payroll financial finalization ${enabled ? 'enabled' : 'disabled'}. No salaries approved or payments recorded.`);
 } catch (error) { await client.query('ROLLBACK'); throw error; }
 finally { await client.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode=1; });
