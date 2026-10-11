import { describe, test, expect, afterEach } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { getLocalTestTarget } = require('../../../src/config/localTestTarget');
const { validateStatus } = require('../../../scripts/lib/check-local-supabase-status');
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-runner-test-')); roots.push(root);
  const backend = path.join(root, 'backend');
  for (const dir of ['scripts/lib', 'src/config', 'node_modules/.bin', 'tests/local-supabase/supabase', 'fakebin', 'tmp']) fs.mkdirSync(path.join(backend, dir), { recursive: true });
  for (const file of ['scripts/test-local.sh', 'scripts/lib/check-local-supabase-status.js', 'src/config/localTestTarget.js']) fs.copyFileSync(path.resolve(file), path.join(backend, file));
  const log = path.join(root, 'calls.log');
  function executable(file, body) { fs.writeFileSync(path.join(backend, file), `#!/usr/bin/env bash\nset -eu\n${body}\n`, { mode: 0o755 }); }
  executable('node_modules/.bin/supabase', `
    printf 'cli %s\\n' "$*" >> "$CALL_LOG"
    case "$*" in *' start') touch "$START_MARKER"; exit "\${START_EXIT:-0}" ;; esac
    case "\${STATUS_MODE:-running}" in
      stopped) [ -f "$START_MARKER" ] || exit 1 ;;
      error) exit 1 ;;
      malformed) printf 'API_URL=http://127.0.0.1:54321'; exit 0 ;;
    esac
    api=54321; db=54322
    case "$*" in *tests/local-supabase*) api=55421; db=55422 ;; esac
    [ "\${STATUS_MODE:-}" != wrong_target ] || api=9999
    printf '{"API_URL":"http://127.0.0.1:%s","DB_URL":"postgresql://postgres:postgres@127.0.0.1:%s/postgres"}' "$api" "$db"
  `);
  executable('fakebin/node', `
    case "$1" in *check-local-supabase-status.js) exec "$REAL_NODE" "$@" ;; esac
    printf 'migrate %s %s %s\\n' "$SUPABASE_URL" "$SUPABASE_TEST_DB_URI" "$USE_DEV_DB" >> "$CALL_LOG"
    exit "\${MIGRATION_EXIT:-0}"
  `);
  executable('fakebin/docker', `
    printf 'docker %s\\n' "$*" >> "$CALL_LOG"
    [ "\${DOCKER_EXIT:-0}" = 0 ] || exit "$DOCKER_EXIT"
    if [ "\${DB_RUNNING:-false}" = true ]; then echo supabase_db_SNPolymers; fi
  `);
  executable('fakebin/npm', 'printf "npm %s\\n" "$*" >> "$CALL_LOG"; exit "${TEST_EXIT:-0}"');
  executable('node_modules/.bin/vitest', 'printf "vitest %s %s %s\\n" "$*" "$SUPABASE_URL" "$SUPABASE_TEST_DB_URI" >> "$CALL_LOG"; exit "${TEST_EXIT:-0}"');
  return (extra = {}, args = ['tests/vitest/regression/example.test.js']) => {
    const result = spawnSync('bash', [path.join(backend, 'scripts/test-local.sh'), ...args], {
      cwd: backend, encoding: 'utf8', timeout: 10000,
      env: { ...process.env, PATH: `${backend}/fakebin:${process.env.PATH}`, REAL_NODE: process.execPath,
        TMPDIR: `${backend}/tmp`, CALL_LOG: log, START_MARKER: `${root}/started`, USE_DEV_DB: 'true', ...extra }
    });
    return { ...result, calls: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '' };
  };
}
function preserved(result) { expect(result.calls).not.toMatch(/cli .*\b(stop|reset)\b|--no-backup/); }
describe('local test runner preserves existing Supabase data', () => {
  test('reuses API_URL JSON without starting or stopping an existing instance', () => {
    const result = fixture()(); expect(result.status).toBe(0);
    expect(result.calls).not.toContain(' start'); preserved(result);
    expect(result.calls).toContain('migrate http://127.0.0.1:54321 postgresql://postgres:postgres@127.0.0.1:54322/postgres false');
  });
  test('malformed successful status fails closed without startup or migrations', () => {
    const result = fixture()({ STATUS_MODE: 'malformed' }); expect(result.status).not.toBe(0);
    expect(result.calls).not.toMatch(/ start|migrate|vitest/); preserved(result);
  });
  test('unexpected local ports fail closed instead of migrating the wrong database', () => {
    const result = fixture()({ STATUS_MODE: 'wrong_target' }); expect(result.status).not.toBe(0);
    expect(result.calls).not.toMatch(/ start|migrate|vitest/); preserved(result);
  });
  test('CLI failure with a running Docker database never starts or migrates', () => {
    const result = fixture()({ STATUS_MODE: 'error', DB_RUNNING: 'true' }); expect(result.status).not.toBe(0);
    expect(result.calls).toContain('docker ps'); expect(result.calls).not.toMatch(/ start|migrate|vitest/); preserved(result);
  });
  test('Docker permission/daemon failure cannot be mistaken for a stopped stack', () => {
    const result = fixture()({ STATUS_MODE: 'error', DOCKER_EXIT: '1' }); expect(result.status).not.toBe(0);
    expect(result.calls).not.toMatch(/ start|migrate|vitest/); preserved(result);
  });
  test('a stopped stack is started, verified and retained after tests', () => {
    const result = fixture()({ STATUS_MODE: 'stopped' }); expect(result.status).toBe(0);
    expect(result.calls).toContain(' start'); expect(result.calls.match(/status --output json/g)).toHaveLength(2); preserved(result);
  });
  test('failed startup never proceeds to migrations or performs cleanup', () => {
    const result = fixture()({ STATUS_MODE: 'stopped', START_EXIT: '7' }); expect(result.status).toBe(7);
    expect(result.calls).not.toMatch(/migrate|vitest/); preserved(result);
  });
  test('migration failure preserves the stack and the real exit code', () => {
    const result = fixture()({ MIGRATION_EXIT: '8' }); expect(result.status).toBe(8);
    expect(result.calls).not.toContain('vitest'); preserved(result);
  });
  test('test failure preserves fixtures and returns the real exit code', () => {
    const result = fixture()({ TEST_EXIT: '9' }); expect(result.status).toBe(9); preserved(result);
  });
  test('isolated mode targets another workdir, project and ports', () => {
    const result = fixture()({}, ['--isolated', 'tests/vitest/regression/example.test.js']); expect(result.status).toBe(0);
    expect(result.calls).toContain('tests/local-supabase status --output json');
    expect(result.calls).toContain('migrate http://127.0.0.1:55421 postgresql://postgres:postgres@127.0.0.1:55422/postgres false'); preserved(result);
  });
  test.each([[], ['tests/vitest/regression'], ['tests/vitest']].map(args => ({ args })))('broad selection $args uses isolation because it includes payroll', ({ args }) => {
    const result = fixture()({}, args); expect(result.status).toBe(0);
    expect(result.calls).toContain('http://127.0.0.1:55421'); preserved(result);
  });
  test('explicit payroll test selections automatically use isolation', () => {
    const result = fixture()({}, ['tests/vitest/regression/payrollFoundation.test.js']); expect(result.status).toBe(0);
    expect(result.calls).toContain('http://127.0.0.1:55421'); preserved(result);
  });
});
describe('fixed local targets and status validation', () => {
  test('only known local profiles are accepted; malicious host prefixes are rejected', () => {
    expect(getLocalTestTarget('payroll').projectId).toBe('SNPolymersPayrollTests');
    expect(() => getLocalTestTarget('https://remote.example')).toThrow();
    expect(() => validateStatus({ API_URL: 'http://localhost.attacker.example:55421', DB_URL: getLocalTestTarget('payroll').dbUri }, getLocalTestTarget('payroll'))).toThrow();
  });
  test('Vitest and server-side Supabase client resolve the same isolated target', () => {
    const prior = process.env.LOCAL_SUPABASE_TEST_PROFILE;
    process.env.LOCAL_SUPABASE_TEST_PROFILE = 'payroll';
    try {
      const config = require('../../../vitest.config');
      expect(config.test.env.SUPABASE_URL).toBe('http://127.0.0.1:55421');
      expect(config.test.env.SUPABASE_TEST_DB_URI).toBe(getLocalTestTarget('payroll').dbUri);
      const modulePath = require.resolve('../../../src/db/supabase');
      delete require.cache[modulePath];
      expect(require(modulePath).supabase.supabaseUrl).toBe('http://127.0.0.1:55421');
      delete require.cache[modulePath];
    } finally {
      if (prior === undefined) delete process.env.LOCAL_SUPABASE_TEST_PROFILE;
      else process.env.LOCAL_SUPABASE_TEST_PROFILE = prior;
    }
  });
});
