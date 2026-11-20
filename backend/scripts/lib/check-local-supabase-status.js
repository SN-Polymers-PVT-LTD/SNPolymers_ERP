// Validate machine-readable CLI status without printing credentials.
const fs = require('fs');
const { getLocalTestTarget } = require('../../src/config/localTestTarget');
function validateStatus(status, target) {
  if (!status || typeof status !== 'object' || Array.isArray(status)) throw new Error('Invalid Supabase status JSON.');
  const api = new URL(status.API_URL);
  const db = new URL(status.DB_URL);
  const expectedApi = new URL(target.apiUrl);
  const expectedDb = new URL(target.dbUri);
  const local = url => ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (!local(api) || !local(db) || api.protocol !== 'http:' || db.protocol !== 'postgresql:' ||
      api.port !== expectedApi.port || db.port !== expectedDb.port || api.pathname !== '/' || db.pathname !== '/postgres' ||
      db.username !== expectedDb.username || db.password !== expectedDb.password) {
    throw new Error('Supabase status does not match the selected local test target.');
  }
}
if (require.main === module) {
  try {
    const target = getLocalTestTarget();
    if (process.argv[2] === '--target') {
      const field = process.argv[3];
      if (!['projectId', 'apiUrl', 'dbUri'].includes(field)) throw new Error('Invalid target field.');
      process.stdout.write(target[field]);
    } else {
      validateStatus(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), target);
    }
  } catch (error) {
    console.error(`Local Supabase status validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
module.exports = { validateStatus };
