#!/usr/bin/env node
/**
 * Runs all manifest generators (schema, RPC, index).
 */
const { spawnSync } = require('child_process');
const path = require('path');

const generators = [
  'generate-schema-manifest.js',
  'generate-rpc-manifest.js',
  'generate-index-manifest.js'
];

for (const script of generators) {
  const result = spawnSync('node', [path.join(__dirname, script)], { stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
