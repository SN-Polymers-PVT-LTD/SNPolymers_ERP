const pkg = require('../../package.json');

/**
 * Deployment fingerprint for /health and smoke checks.
 * Render injects RENDER_GIT_COMMIT; CI can set GIT_SHA / GIT_BRANCH / BUILD_TIMESTAMP.
 */
function getBuildInfo() {
  const rawSha = process.env.GIT_SHA
    || process.env.RENDER_GIT_COMMIT
    || 'dev';

  const git = rawSha === 'dev' ? 'dev' : String(rawSha).slice(0, 7);

  return {
    version: pkg.version,
    git,
    branch: process.env.GIT_BRANCH
      || process.env.RENDER_GIT_BRANCH
      || 'local',
    built: process.env.BUILD_TIMESTAMP || null
  };
}

module.exports = { getBuildInfo };
