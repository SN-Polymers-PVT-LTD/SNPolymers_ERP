# Vitest Test Suite Usage Guide

Welcome to the newly migrated backend test suite powered by **Vitest**. This guide explains how to configure, run, and maintain the test suite.

---

## 🚀 Getting Started

### 1. Requirements
* Node.js (v18 or higher recommended)
* Supabase Database access (defined in `.env` or system environment variables)

### 2. Install Dependencies
If not already installed, make sure to install development dependencies:
```bash
npm install
```

---

## 🛠️ Configuration (`vitest.config.js`)

The test suite is configured with strict defaults in `backend/vitest.config.js` to ensure reliable integration test runs:
* **CommonJS Mode**: Kept fully compatible with the CommonJS backend codebase.
* **Disable Parallelism**: `fileParallelism: false` and `maxWorkers: 1` are set to prevent different integration test suites from modifying database tables concurrently.
* **Test Sequence**: `sequence.sequential: true` executes the suites sequentially.

---

## 🏃 Running Tests

You can run the test suite using standard npm scripts or directly via `npx vitest`.

### Run All Tests
To run all test suites in the `tests/vitest` directory sequentially:
```bash
npm run test:vitest
# or
npx vitest run
```

### Run a Single Test File
To run a specific test file, pass the file path:
```bash
npx vitest run tests/vitest/milestones/milestone3.test.js
```

### Watch Mode (Interactive development)
To start Vitest in watch mode (re-runs tests automatically when files change):
```bash
npx vitest
```

### UI & HTML Reports
Vitest generates an HTML report automatically on runs. To view the interactive report dashboard in your browser:
```bash
npx vite preview --outDir html
```

---

## ✍️ Writing & Migrating Tests

### Structure of a Test File
All Vitest test files reside under `tests/vitest/` (e.g., `tests/vitest/milestones/`). Under the hood, Vitest executes test files using ESM module resolution, but the backend uses CommonJS. 

Always structure test files as follows:
```javascript
// 1. Import vitest APIs using ES imports
import { describe, test, expect, beforeAll, afterAll } from 'vitest';

// 2. Import backend controllers, services, or config using require()
const { supabase } = require('../../../src/db/supabase');
const mockRes = require('../../helpers/mockRes');
const { submitEstimate } = require('../../../src/controllers/estimates.controller');

describe('My Feature Suite', () => {
  beforeAll(async () => {
    // Setup logic
  });

  afterAll(async () => {
    // Cleanup logic
  });

  test('Test case description', async () => {
    const req = { ... };
    const res = mockRes();
    await submitEstimate(req, res);
    
    expect(res.statusCode).toBe(200);
  });
});
```

---

## ⚠️ Important Guidelines

1. **Do Not Copy Helpers**: Always use helper scripts from `tests/helpers/` (e.g. `mockRes`, `setupProject`, `setupUsers`). Do not copy these helpers to local subdirectories.
2. **Dynamic Project Setup**: Integration tests for complex workflows should dynamically generate unique project work orders (`TEST_WO_XXX`) using the `setupProject` helper in `beforeAll`. This avoids budget/duplicate constraint clashes.
3. **Database Cleanup**: Always include an `afterAll` hook to clean up mock database entries inserted during the suite.
