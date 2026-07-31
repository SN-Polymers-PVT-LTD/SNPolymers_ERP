# Regression-Prevention Plan — ESLint Hardening + Vitest Smoke Tests

**Scope:** two independent workstreams that together close the gap ESLint alone can't cover — orphaned references / ad-hoc styling (static analysis) and a blank-render regression (runtime rendering).

---

## Current state (verified against the codebase)

- `eslint.config.js` has no `eslint-plugin-import` — nothing currently catches a reference to a file/export that no longer exists.
- No rule bans inline `style={{...}}` — nothing stops ad-hoc styling from creeping into a Tailwind-only codebase.
- `@testing-library/react`, `@testing-library/user-event`, and `@testing-library/jest-dom` are installed in `frontend/package.json` but not currently exercised — the reviewed frontend tests (e.g. `SCurveProgressChart.test.js`) primarily exercise calculation logic rather than mounted React components.
- `frontend/package.json` has **no `test` script at all**. `frontend/vite.config.js` has no `test:` block, so there's no Vitest environment (jsdom vs node) configured for the frontend.
- `AuthProvider` calls `authApi.get('/me')` on mount via axios — any component-rendering test that mounts `<App />` or anything wrapped in `AuthProvider` will fire a real network call unless mocked.

This means Part B isn't "add a few tests" — it's standing up React-rendering test infrastructure for the first time on this frontend.

---

## Part A — ESLint hardening

### A.1 Add `eslint-plugin-import`

```bash
cd frontend
npm install --save-dev eslint-plugin-import
```
If the project uses import aliases (check `vite.config.js`/`jsconfig.json` for a `@/`-style alias), install an appropriate resolver (e.g. `eslint-import-resolver-alias`) at that point — no need to add it speculatively.

### A.2 Config intent (`frontend/eslint.config.js`)

Enable, on top of the existing rule set:

- `import/no-unresolved`, `import/named` — catch a reference to a file or export that no longer exists (the rule that catches "removed a mount and left a dangling import")
- A restriction on inline `style={{...}}` JSX attributes — this codebase is Tailwind-only, so an inline style is usually a shortcut rather than an intentional choice. Word the lint message as a restriction with a required justification, not an absolute ban — legitimate exceptions exist (dynamic transforms, CSS custom properties, canvas/chart pixel positioning), and the analytics chart components in this repo already do real computed positioning. Any exception should require an explicit `eslint-disable-next-line` with a one-line reason, not a rule that pretends there are no valid cases.
- Worth evaluating alongside these, though not required for this pass: `import/no-cycle` (circular imports) and `import/no-duplicates` (repeated imports from the same module) — both are cheap additions once `eslint-plugin-import` is already in the config, but scope them in or out based on what the initial `no-unresolved`/`named` run turns up.

The exact rule syntax and selector belongs in the PR, not this plan — write it against the actual `eslint.config.js` at implementation time so it's reviewed as real code, not pre-approved from a document.

### A.3 Rollout steps

1. Add the plugin and config change on a branch.
2. Run `npx eslint . ` and expect a real batch of hits on both new rules — `import/no-unresolved` in particular can surface path-casing issues that work on case-insensitive filesystems (most dev machines) but break on case-sensitive CI/prod. Treat every hit here as a genuine bug, not noise.
3. For inline-style hits: the correct fix is almost always converting to Tailwind classes. Where a value is genuinely dynamic (e.g. a computed chart pixel offset in the analytics chart components, which do real canvas-style positioning), use a scoped `eslint-disable-next-line` with a comment, not a blanket exemption for the file.
4. Do **not** land this in the same PR as the 39-warning cleanup from the earlier lint plan — different rules, different fix patterns, easier to review separately.

### A.4 What this deliberately does not attempt

`import/no-unresolved` catches a **dangling reference**, not a **removed mount with no dangling reference** (e.g. deleting `<Route path="/dashboard">` entirely, with no leftover import) — that's a semantically valid change ESLint has no way to flag as wrong, because it doesn't know your app's intended route surface. That's what Part B is for.

---

## Part B — Vitest smoke tests for critical mount points

### B.1 Goal

Catch "the app (or a major section of it) fails to render, or a route silently disappears" — the class of bug static analysis cannot see, because it requires actually mounting the component tree.

### B.2 Infrastructure setup (one-time)

**1. Add a `test` block to `frontend/vite.config.js`:**

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  return {
    plugins: [react()],
    server: { port: 5173, host: true },
    build: {
      minify: mode === 'production' ? 'esbuild' : 'esbuild',
    },
    esbuild: {
      drop: mode === 'production' ? ['console', 'debugger'] : []
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.js'],
      css: false,
    },
  };
})
```

**2. Add `frontend/src/test/setup.js`:**

```js
import '@testing-library/jest-dom/vitest';
```

**3. Add the `test` script to `frontend/package.json`** (currently missing entirely):

```json
"test": "vitest run",
"test:watch": "vitest"
```

**4. Install the jsdom environment package** (Vitest needs it explicitly since v1+):

```bash
npm install --save-dev jsdom
```

### B.3 Mocking strategy

`AuthProvider` fires a real `authApi.get('/me')` call on mount. Smoke tests should not depend on network availability or a live backend — mock the API layer, not the component:

```js
// frontend/src/test/mocks/authApi.js
import { vi } from 'vitest';

vi.mock('../../api/authApi', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: { success: false } }), // unauthenticated by default
    post: vi.fn().mockResolvedValue({ data: { success: true } }),
  },
}));
```

Import this mock at the top of any smoke test that mounts `<App />` or anything wrapped in `AuthProvider`. For tests that need an authenticated state (to reach a protected route), override the mock's resolved value per-test rather than building a second mock file.

### B.4 What to test — critical mount points, not full coverage

This is deliberately narrow. The goal is "did the app fail to render," not component-level correctness (that's a separate, larger initiative if you want it later).

| Test | What it catches |
|---|---|
| `App.test.jsx` — renders `<App />` at `/`, asserts `Home` page content is present | The entire provider tree (`QueryClientProvider` → `ThemeProvider` → `ModalProvider` → `AuthProvider` → `Router`) is intact — this is the one that catches a genuinely blank screen |
| `App.test.jsx` — renders at `/login` and `/dashboard` (mocked authenticated), asserts route-specific expected content is present (e.g. the login form's submit button, a dashboard heading) | A removed or broken `<Route>` entry — checked against real expected UI, not just "the DOM has something in it" |
| `Sidebar.test.jsx` — renders `<Sidebar />` with a mocked authenticated user, asserts each of the ~18 nav labels is present | A nav entry silently disappearing (exactly the class of regression that prompted this whole conversation) |
| `ProtectedRoute.test.jsx` — renders a protected route as unauthenticated, asserts redirect to `/login` occurs | Auth-gating regressions — arguably higher severity than a visual bug |
| `App.test.jsx` — renders at an unknown path (e.g. `/this-does-not-exist`), asserts the `*` catch-all redirect to `/` still fires | Routing fallback silently breaking — a common side effect of careless route-table edits |

Six tests. Not a full suite — a tripwire.

### B.5 Example test

```jsx
// frontend/src/App.test.jsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import '../test/mocks/authApi';
import App from './App';

describe('App smoke test', () => {
  it('renders the home page with expected content, not a blank shell', () => {
    window.history.pushState({}, '', '/');
    render(<App />);
    // Assert something a blank <div></div> would never satisfy —
    // an empty-DOM check alone would still pass on a broken render.
    expect(screen.getByText(/sn polymers/i)).toBeInTheDocument();
  });
});
```
Adjust the exact text/role matcher to whatever `Home` actually renders (a heading, a login CTA, etc.) — the point is asserting specific expected UI, not merely "the DOM isn't empty."

### B.6 CI — see Part C

No CI pipeline currently exists for this repo (confirmed — no `.github/workflows/` directory in the reviewed backup). Wiring `npm test` into "the existing pipeline" isn't possible because there isn't one yet; see Part C below for the actual pipeline this plan depends on.

---

## Part C — GitHub Actions pipeline (net new)

### C.1 Current state

- No `.github/workflows/` directory exists. Nothing runs automatically on push or PR today — lint, build, and test are all manual, developer-run commands.
- Backend has a `test` script (`vitest run`), but those tests import the real `supabase` client and perform live inserts/deletes against actual tables (`backend/tests/vitest/milestones/*.test.js`, `backend/vitest.config.js` forces `fileParallelism: false` specifically to avoid DB collisions between tests) — these are integration tests against a real database, not isolated unit tests.
- Backend has **no lint script at all** — only `frontend/package.json` has one. Out of scope to add here, but worth a separate ticket.
- `backend/.env` is present in this backup with what appear to be real credentials. Confirm it's `.gitignore`'d in the actual git repo before doing anything else — if it's ever been committed, those credentials should be rotated regardless of this CI work.

### C.2 Decision required before implementation: backend test strategy in CI

Running the existing backend test suite in CI means either:

- **(a)** Provision a dedicated Supabase test project, store its URL/service-role key as GitHub Actions secrets, and point CI at that instead of production/staging. Safest option, but requires infra setup outside this repo (a new Supabase project, migrations replayed into it) — not a code change alone.
- **(b)** Skip backend integration tests in the standard PR gate for now, run `npm run lint && npm run build` equivalents for backend (once a lint script exists) as the PR gate, and run the full backend suite on a separate manual or nightly workflow against a controlled environment.

I'd default to **(b)** for the initial pipeline — it ships CI immediately without a database-provisioning dependency blocking it — and treat (a) as a fast-follow once someone owns setting up the dedicated test project. Flagging this explicitly because silently choosing one on your behalf would be the wrong call for a decision with real infra and cost implications.

### C.3 Workflow — `.github/workflows/ci.yml`

Frontend job only for the initial pipeline, per the C.2 decision. Structured as two path-filtered jobs so an unrelated backend-only change doesn't wait on frontend CI and vice versa (once a backend job is added).

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  frontend:
    name: Frontend — lint, test, build
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json

      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run build

  # backend:
  #   Deferred pending the test-strategy decision in §C.2 — add once either
  #   a dedicated test Supabase project exists (option a) or backend gets
  #   a lint script and the integration suite is moved to a separate
  #   scheduled workflow (option b).
```

Notes on choices made here:
- `npm ci`, not `npm install` — reproducible installs from the lockfile, standard for CI.
- `cache: 'npm'` with an explicit `cache-dependency-path` — this is a monorepo-shaped layout (`frontend/` and `backend/` each with their own `package-lock.json`), so the default cache path guess would miss.
- `concurrency` with `cancel-in-progress` — a new push to the same PR cancels the previous run instead of both running to completion, saving CI minutes.
- Node 20 — not specified anywhere in either `package.json`'s `engines` field currently; confirm this matches what's actually deployed (check your hosting platform, e.g. Vercel's configured Node version) rather than assuming.

### C.4 Branch protection (do this alongside, not instead of, the workflow file)

A workflow file alone doesn't block anything — someone can still merge a red PR unless branch protection requires the check. Once `ci.yml` has run successfully at least once (so GitHub knows the check name exists):
1. Repo Settings → Branches → add a protection rule for `main`
2. Require status checks to pass before merging → select the `frontend` job
3. Consider requiring this alongside existing review requirements, not replacing them



---

## Milestones

### Milestone 1 — ESLint hardening (0.5 day)
- Install `eslint-plugin-import`, add config, run and fix violations
- **Exit criteria:** `npm run lint` clean with both new rules active; no `eslint-disable` added without an inline justification comment

### Milestone 2 — Vitest React infrastructure (0.5 day)
- `vite.config.js` test block, `jsdom` dependency, `setup.js`, `authApi` mock, `test` script added
- **Exit criteria:** a trivial `expect(true).toBe(true)`-style render test passes via `npm test`, proving the jsdom + RTL pipeline actually works end to end before writing real assertions

### Milestone 3 — Six smoke tests (0.5–1 day)
- Write the tests in §B.4
- **Exit criteria:** all five pass against current `main`; deliberately break one (e.g. comment out a `<Route>`) locally to confirm the suite actually fails — a smoke test that's never been proven to fail is not trustworthy

### Milestone 4 — GitHub Actions pipeline (0.5 day, plus a decision checkpoint)
- **Decision checkpoint first:** confirm backend test strategy per §C.2 (a vs b) before writing the workflow — this determines whether the initial pipeline is frontend-only or includes backend
- Add `.github/workflows/ci.yml` (frontend job per §C.3)
- Confirm `backend/.env` is `.gitignore`'d and was never committed — rotate credentials if it was
- Enable branch protection on `main` requiring the `frontend` check (§C.4)
- **Exit criteria:** a PR that intentionally removes a route or nav item fails the required check and cannot be merged without override, not just flagged in review

**Total: ~2–2.5 days**, sequential (each milestone depends on the previous), single frontend engineer — plus an unscoped dependency if the backend test strategy decision in §C.2 lands on option (a), since provisioning a dedicated Supabase test project is infra work outside this engineer's normal scope.

---

## Success criteria

- ESLint detects unresolved imports and invalid named exports.
- Inline styles are restricted, with any exceptions requiring a documented, scoped suppression.
- Frontend has a working jsdom + Vitest rendering environment (currently absent entirely).
- Critical application routes — home, login, an authenticated route, and the unknown-route fallback — render successfully under test.
- Sidebar navigation is covered by a smoke test asserting expected nav items are present.
- Frontend tests execute in CI, not just locally.
- A required GitHub Actions status check blocks merging a PR that fails lint, tests, or build.
- Backend test strategy in CI (live-DB integration tests) is a conscious decision, documented, not silently deferred.

---

## Explicitly out of scope here

- Full component test coverage — this plan is a tripwire for catastrophic regressions, not a testing strategy overhaul.
- Visual/pixel regression testing (Playwright screenshot diffing, Chromatic) — still the right tool for "CSS silently shifted" but a separate tooling investment, not covered by Vitest + RTL.
- Stylelint for genuine `.css` file linting — only relevant if `!important` or raw CSS starts appearing outside JSX; not needed today since the codebase is Tailwind-only.
