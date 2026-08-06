import { describe, test, expect } from 'vitest';
const path = require('path');
const fs = require('fs');
const { fetchRpcFunctions } = require('../../../scripts/lib/manifest-queries');

const expected = require('../../manifests/rpcManifest.generated.js');
const allowlist = require('../../manifests/rpcAllowlist.json');

describe('rpcSignature — live DB matches generated RPC manifest', () => {
  test('manifest file exists and covers all allowlisted RPCs', () => {
    const manifestPath = path.join(__dirname, '../../manifests/rpcManifest.generated.js');
    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(Object.keys(expected.functions).sort()).toEqual([...allowlist].sort());
  });

  test('live pg_proc signatures match committed RPC manifest', async () => {
    const live = await fetchRpcFunctions(allowlist);
    expect(live).toEqual(expected.functions);
  });
});
