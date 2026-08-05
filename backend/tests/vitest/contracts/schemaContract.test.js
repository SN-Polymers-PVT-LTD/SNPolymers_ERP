import { describe, test, expect } from 'vitest';
const path = require('path');
const fs = require('fs');
const { fetchSchemaTables } = require('../../../scripts/lib/manifest-queries');

const expected = require('../../manifests/schemaManifest.generated.js');
const scope = require('../../manifests/manifestScope.json');

describe('schemaContract — live DB matches generated manifest', () => {
  test('manifest file exists and covers all scoped tables', () => {
    const manifestPath = path.join(__dirname, '../../manifests/schemaManifest.generated.js');
    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(Object.keys(expected.tables).sort()).toEqual([...scope.tables].sort());
  });

  test('live information_schema matches committed schema manifest', async () => {
    const live = await fetchSchemaTables(scope.tables);
    expect(live).toEqual(expected.tables);
  });
});
