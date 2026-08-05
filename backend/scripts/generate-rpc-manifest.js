#!/usr/bin/env node
'use strict';

const { loadJson, fetchRpcFunctions } = require('./lib/manifest-queries');
const { writeGeneratedManifest } = require('./lib/write-manifest');

async function main() {
  const functionNames = loadJson('rpcAllowlist.json');
  const functions = await fetchRpcFunctions(functionNames);
  const filePath = writeGeneratedManifest('rpcManifest.generated.js', { functions });
  console.log(`Wrote ${filePath} (${functionNames.length} functions)`);
}

main().catch((error) => {
  console.error(`generate:rpc-manifest failed: ${error.message}`);
  process.exit(1);
});
