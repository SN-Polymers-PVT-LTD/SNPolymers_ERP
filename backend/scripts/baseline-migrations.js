#!/usr/bin/env node
/**
 * Mark migration files as already applied without executing SQL.
 * Use once when connecting migrate tooling to an existing Supabase project
 * whose schema was created outside _migration_log (e.g. dashboard / older deploy).
 *
 * Usage:
 *   SUPABASE_TEST_DB_URI=... node scripts/baseline-migrations.js --yes
 *   SUPABASE_TEST_DB_URI=... node scripts/baseline-migrations.js --yes --exclude 008_create_increment_otp_attempts_rpc.sql
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createPgClient } = require('./lib/pg-connect');

const MIGRATIONS_DIR = path.join(__dirname, '../src/db/migrations');

function leadingNumber(filename) {
  const match = filename.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

function sortMigrations(files) {
  return files
    .filter((file) => file.endsWith('.sql'))
    .sort((a, b) => {
      const diff = leadingNumber(a) - leadingNumber(b);
      return diff !== 0 ? diff : a.localeCompare(b);
    });
}

function parseArgs(argv) {
  const options = { yes: false, exclude: new Set() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--yes') {
      options.yes = true;
    } else if (arg === '--exclude') {
      const value = argv[i + 1];
      if (!value) throw new Error('--exclude requires a migration filename');
      options.exclude.add(value);
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!options.yes) {
    console.error(
      '\n[baseline-migrations] Refusing to run without --yes.\n' +
        'This marks migrations as applied WITHOUT executing SQL.\n' +
        'Only use on a database that already has the schema.\n\n' +
        'Example:\n' +
        '  npm run migrate:baseline:dev -- --yes\n' +
        '  npm run migrate:baseline:dev -- --yes --exclude 008_create_increment_otp_attempts_rpc.sql\n'
    );
    process.exit(1);
  }

  const dbUri = process.env.SUPABASE_TEST_DB_URI;
  if (!dbUri) {
    console.error('[baseline-migrations] SUPABASE_TEST_DB_URI is not set.');
    process.exit(1);
  }

  const sorted = sortMigrations(fs.readdirSync(MIGRATIONS_DIR));
  const toBaseline = sorted.filter((file) => !options.exclude.has(file));

  if (toBaseline.length === 0) {
    console.log('[baseline-migrations] Nothing to baseline.');
    return;
  }

  const client = await createPgClient(dbUri);
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public._migration_log (
        id          SERIAL       PRIMARY KEY,
        filename    TEXT         UNIQUE NOT NULL,
        applied_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
      );
    `);

    const { rows } = await client.query('SELECT filename FROM public._migration_log');
    const applied = new Set(rows.map((row) => row.filename));

    let inserted = 0;
    for (const filename of toBaseline) {
      if (applied.has(filename)) {
        console.log(`  [SKIP]  ${filename}`);
        continue;
      }
      await client.query(
        'INSERT INTO public._migration_log (filename) VALUES ($1)',
        [filename]
      );
      console.log(`  [MARK]  ${filename}`);
      inserted += 1;
    }

    console.log(`\n[baseline-migrations] Done — ${inserted} marked, ${toBaseline.length - inserted} already recorded.\n`);

    if (options.exclude.size > 0) {
      console.log('[baseline-migrations] Excluded (still pending for npm run migrate):');
      for (const file of options.exclude) {
        console.log(`  - ${file}`);
      }
      console.log('');
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('\n[baseline-migrations] Fatal error:', error.message);
  process.exit(1);
});
