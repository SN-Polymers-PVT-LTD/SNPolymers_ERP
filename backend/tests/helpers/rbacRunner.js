const requireRole = require('../../src/middleware/requireRole');
const requireAdmin = require('../../src/middleware/requireAdmin');
const mockRes = require('./mockRes');
const { userForRole } = require('./rbacUsers');

function runMiddlewareCase(row, ctx, expect) {
  const middleware = row.guard === 'requireAdmin'
    ? requireAdmin
    : requireRole(row.allowedRoles);

  let nextCalled = false;
  const req = { user: userForRole(ctx, row.role) };
  const res = mockRes();

  middleware(req, res, () => {
    nextCalled = true;
  });

  if (row.expectAllowed) {
    expect(nextCalled).toBe(true);
    expect(res.statusCode).not.toBe(403);
  } else {
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.jsonData?.success).toBe(false);
  }
}

async function runControllerCase(row, ctx, expect) {
  const req = row.buildReq(ctx);
  const res = mockRes();

  await row.handler(req, res);

  expect(res.statusCode).toBe(row.expectStatus);
  if (row.expectStatus === 403) {
    expect(res.jsonData?.success).toBe(false);
  }
}

module.exports = {
  runMiddlewareCase,
  runControllerCase
};
