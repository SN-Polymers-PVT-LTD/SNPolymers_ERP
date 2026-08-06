import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const { RBAC_MATRIX } = require('../../helpers/rbacMatrix');
const { seedRbacUsers, cleanupRbacUsers } = require('../../helpers/rbacUsers');
const { runMiddlewareCase, runControllerCase } = require('../../helpers/rbacRunner');

describe('rbacMatrix — role × endpoint access', () => {
  let ctx;

  beforeAll(async () => {
    ctx = await seedRbacUsers();
  });

  afterAll(async () => {
    await cleanupRbacUsers(ctx);
  });

  test.each(RBAC_MATRIX)('$id', async (row) => {
    if (row.layer === 'middleware') {
      runMiddlewareCase(row, ctx, expect);
    } else {
      await runControllerCase(row, ctx, expect);
    }
  });
});
