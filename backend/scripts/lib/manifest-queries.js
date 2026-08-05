'use strict';

const { createPgClient } = require('./pg-connect');
const fs = require('fs');
const path = require('path');

const MANIFESTS_DIR = path.join(__dirname, '../../tests/manifests');

function loadJson(filename) {
  return JSON.parse(fs.readFileSync(path.join(MANIFESTS_DIR, filename), 'utf8'));
}

function getDbUri() {
  const dbUri = process.env.SUPABASE_TEST_DB_URI;
  if (!dbUri) {
    throw new Error('SUPABASE_TEST_DB_URI is not set');
  }
  return dbUri;
}

async function withClient(fn) {
  const client = await createPgClient(getDbUri());
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function fetchSchemaTables(tableNames) {
  return withClient(async (client) => {
    const { rows } = await client.query(
      `SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])
       ORDER BY table_name, ordinal_position`,
      [tableNames]
    );

    const tables = {};
    for (const tableName of tableNames) {
      tables[tableName] = { columns: {} };
    }

    for (const row of rows) {
      tables[row.table_name].columns[row.column_name] = {
        type: row.data_type,
        udtName: row.udt_name,
        nullable: row.is_nullable === 'YES',
        default: row.column_default ?? null
      };
    }

    const missingTables = tableNames.filter((name) => Object.keys(tables[name].columns).length === 0);
    if (missingTables.length > 0) {
      throw new Error(`Schema manifest: no columns found for tables: ${missingTables.join(', ')}`);
    }

    return tables;
  });
}

function parseRpcArguments(argsString) {
  if (!argsString || argsString.trim() === '') {
    return [];
  }

  return argsString.split(',').map((part) => {
    const trimmed = part.trim();
    const spaceIndex = trimmed.indexOf(' ');
    if (spaceIndex === -1) {
      return { name: trimmed, type: 'unknown' };
    }
    return {
      name: trimmed.slice(0, spaceIndex),
      type: trimmed.slice(spaceIndex + 1).trim()
    };
  });
}

async function fetchRpcFunctions(functionNames) {
  return withClient(async (client) => {
    const { rows } = await client.query(
      `SELECT p.proname,
              pg_get_function_arguments(p.oid) AS args,
              pg_get_function_result(p.oid) AS returns
       FROM pg_proc p
       JOIN pg_namespace n ON p.pronamespace = n.oid
       WHERE n.nspname = 'public'
         AND p.proname = ANY($1::text[])
       ORDER BY p.proname`,
      [functionNames]
    );

    const functions = {};
    for (const row of rows) {
      functions[row.proname] = {
        args: parseRpcArguments(row.args),
        returns: row.returns
      };
    }

    const missing = functionNames.filter((name) => !functions[name]);
    if (missing.length > 0) {
      throw new Error(`RPC manifest: missing functions in database: ${missing.join(', ')}`);
    }

    return functions;
  });
}

async function fetchIndexes(indexNames) {
  return withClient(async (client) => {
    const { rows } = await client.query(
      `SELECT indexname, tablename, indexdef
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname = ANY($1::text[])
       ORDER BY indexname`,
      [indexNames]
    );

    const indexes = {};
    for (const row of rows) {
      indexes[row.indexname] = {
        table: row.tablename,
        definition: row.indexdef
      };
    }

    const missing = indexNames.filter((name) => !indexes[name]);
    if (missing.length > 0) {
      throw new Error(`Index manifest: missing indexes in database: ${missing.join(', ')}`);
    }

    return indexes;
  });
}

async function fetchAppliedMigrations() {
  return withClient(async (client) => {
    const tableExists = await client.query(
      `SELECT to_regclass('public._migration_log') IS NOT NULL AS exists`
    );
    if (!tableExists.rows[0].exists) {
      return [];
    }
    const { rows } = await client.query(
      `SELECT filename FROM public._migration_log ORDER BY filename`
    );
    return rows.map((row) => row.filename);
  });
}

async function fetchStorageBuckets(expectedBucketIds) {
  return withClient(async (client) => {
    const { rows } = await client.query(
      `SELECT id, name, public, file_size_limit
       FROM storage.buckets
       WHERE id = ANY($1::text[])
       ORDER BY id`,
      [expectedBucketIds]
    );
    return rows;
  });
}

async function refreshAnalyticsViews() {
  return withClient(async (client) => {
    await client.query('SELECT public.refresh_analytics_views()');
  });
}

module.exports = {
  loadJson,
  fetchSchemaTables,
  fetchRpcFunctions,
  fetchIndexes,
  fetchAppliedMigrations,
  fetchStorageBuckets,
  refreshAnalyticsViews,
  parseRpcArguments
};
