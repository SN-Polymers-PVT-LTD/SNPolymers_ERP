import { describe, test, expect } from 'vitest';
const path = require('path');
const fs = require('fs');
const { fetchIndexes } = require('../../../scripts/lib/manifest-queries');

const expected = require('../../manifests/indexManifest.generated.js');
const allowlist = require('../../manifests/indexAllowlist.json');

describe('indexContract — live DB matches generated index manifest', () => {
  test('manifest file exists and covers all allowlisted indexes', () => {
    const manifestPath = path.join(__dirname, '../../manifests/indexManifest.generated.js');
    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(Object.keys(expected.indexes).sort()).toEqual([...allowlist].sort());
  });

  test('live pg_indexes matches committed index manifest', async () => {
    const live = await fetchIndexes(allowlist);
    expect(live).toEqual(expected.indexes);
  });
});
