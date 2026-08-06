#!/usr/bin/env node
'use strict';

const { loadJson, fetchSchemaTables } = require('./lib/manifest-queries');
const { writeGeneratedManifest } = require('./lib/write-manifest');

async function main() {
  const scope = loadJson('manifestScope.json');
  const tables = await fetchSchemaTables(scope.tables);
  const filePath = writeGeneratedManifest('schemaManifest.generated.js', { tables });
  console.log(`Wrote ${filePath} (${scope.tables.length} tables)`);
}

main().catch((error) => {
  console.error(`generate:schema-manifest failed: ${error.message}`);
  process.exit(1);
});
