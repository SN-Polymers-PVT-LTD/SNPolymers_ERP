/**
 * apply-migrations.js
 *
 * Applies pending SQL migration files from backend/src/db/migrations/ to the
 * target database (identified by SUPABASE_TEST_DB_URI).
 *
 * Tracks applied migrations in a `_migration_log` table so it is safe to run
 * repeatedly — already-applied files are always skipped.
 *
 * Usage:
 *   SUPABASE_TEST_DB_URI=<postgres-uri> node scripts/apply-migrations.js
 *
 * In CI this is invoked automatically before `npm test`.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createPgClient } = require('./lib/pg-connect');

const MIGRATIONS_DIR = path.join(__dirname, '../src/db/migrations');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the leading integer from a filename (e.g. "36B_foo.sql" → 36).
 * Files without a leading number get bucket 0.
 */
function leadingNumber(filename) {
  const m = filename.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * Sort migration files:
 *  1. By leading numeric prefix (ascending)
 *  2. Ties broken lexicographically (so 36B < 36C < 36_ by ASCII order)
 */
function sortMigrations(files) {
  return files
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => {
      const diff = leadingNumber(a) - leadingNumber(b);
      return diff !== 0 ? diff : a.localeCompare(b);
    });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const dbUri = process.env.SUPABASE_TEST_DB_URI;

  if (!dbUri) {
    console.error(
      '\n[apply-migrations] ERROR: SUPABASE_TEST_DB_URI is not set.\n' +
        'Set it to the direct Postgres connection URI from:\n' +
        '  Supabase dashboard → Project Settings → Database → Connection string → URI\n'
    );
    process.exit(1);
  }

  const client = await createPgClient(dbUri);

  try {
    await client.connect();
    console.log('[apply-migrations] Connected to database.');

    // Ensure the migration tracking table exists in public schema.
    await client.query(`
      CREATE TABLE IF NOT EXISTS public._migration_log (
        id          SERIAL       PRIMARY KEY,
        filename    TEXT         UNIQUE NOT NULL,
        applied_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
      );
    `);

    // Fetch already-applied filenames.
    const { rows } = await client.query(
      'SELECT filename FROM public._migration_log ORDER BY applied_at'
    );
    const applied = new Set(rows.map((r) => r.filename));

    if (applied.size > 0) {
      console.log(
        `[apply-migrations] ${applied.size} migration(s) already applied — will skip them.`
      );
    }

    // Discover and sort migration files.
    const allFiles = fs.readdirSync(MIGRATIONS_DIR);
    const sorted = sortMigrations(allFiles);

    console.log(
      `[apply-migrations] Found ${sorted.length} migration file(s) in ${MIGRATIONS_DIR}`
    );

    let appliedCount = 0;
    let skippedCount = 0;

    for (const filename of sorted) {
      if (applied.has(filename)) {
        console.log(`  [SKIP]  ${filename}`);
        skippedCount++;
        continue;
      }

      const filePath = path.join(MIGRATIONS_DIR, filename);
      const sql = fs.readFileSync(filePath, 'utf8');

      process.stdout.write(`  [APPLY] ${filename} ... `);

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO public._migration_log (filename) VALUES ($1)',
          [filename]
        );
        await client.query('SET search_path = public, extensions;');
        await client.query('COMMIT');
        console.log('✓');
        appliedCount++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`\n\n[apply-migrations] FAILED on ${filename}:`);
        console.error(err.message);
        throw err;
      }
    }

    console.log(
      `\n[apply-migrations] Done — ${appliedCount} applied, ${skippedCount} skipped.\n`
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  const message = err.message || String(err);
  if (message.includes('ENOTFOUND') && process.env.SUPABASE_TEST_DB_URI?.includes('db.')) {
    console.error(
      '\n[apply-migrations] Hint: db.*.supabase.co is IPv6-only on free tier.\n' +
        '  Use Session pooler URL in .env.dev-db / .env.prod-db instead.\n' +
        '  Supabase Dashboard → Connect → Session pooler → copy URI\n'
    );
  }
  if (message.includes('ENETUNREACH') && process.env.SUPABASE_TEST_DB_URI?.includes('db.')) {
    console.error(
      '\n[apply-migrations] Hint: your network cannot reach Supabase over IPv6.\n' +
        '  Switch .env.*-db to the Session pooler connection string (IPv4).\n'
    );
  }
  console.error('\n[apply-migrations] Fatal error:', message);
  process.exit(1);
});
