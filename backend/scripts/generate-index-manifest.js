#!/usr/bin/env node
'use strict';

const { loadJson, fetchIndexes } = require('./lib/manifest-queries');
const { writeGeneratedManifest } = require('./lib/write-manifest');

async function main() {
  const indexNames = loadJson('indexAllowlist.json');
  const indexes = await fetchIndexes(indexNames);
  const filePath = writeGeneratedManifest('indexManifest.generated.js', { indexes });
  console.log(`Wrote ${filePath} (${indexNames.length} indexes)`);
}

main().catch((error) => {
  console.error(`generate:index-manifest failed: ${error.message}`);
  process.exit(1);
});
