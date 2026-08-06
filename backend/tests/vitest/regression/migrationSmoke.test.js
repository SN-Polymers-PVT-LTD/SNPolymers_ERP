import { describe, test, expect } from 'vitest';
const fs = require('fs');
const path = require('path');
const {
  fetchAppliedMigrations,
  fetchStorageBuckets,
  refreshAnalyticsViews
} = require('../../../scripts/lib/manifest-queries');

const MIGRATIONS_DIR = path.join(__dirname, '../../../src/db/migrations');

const EXPECTED_BUCKETS = [
  'ra-bill-copies',
  'daily-progress-photos',
  'gst-bills',
  'requisition-pdfs'
];

describe('migrationSmoke — database objects after migrate', () => {
  test('all SQL migration files are recorded in _migration_log', async () => {
    const migrationFiles = fs.readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    const applied = await fetchAppliedMigrations();

    for (const file of migrationFiles) {
      expect(applied, `missing migration log entry for ${file}`).toContain(file);
    }
  });

  test('required storage buckets exist', async () => {
    const buckets = await fetchStorageBuckets(EXPECTED_BUCKETS);
    const bucketIds = buckets.map((bucket) => bucket.id).sort();
    expect(bucketIds).toEqual([...EXPECTED_BUCKETS].sort());
  });

  test('refresh_analytics_views runs without error', async () => {
    await expect(refreshAnalyticsViews()).resolves.toBeUndefined();
  });
});
