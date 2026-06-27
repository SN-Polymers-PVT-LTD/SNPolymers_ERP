1. Caching & State Management (React Query)
What you are doing: You are manually calling APIs inside useEffect blocks, managing loading, error, and success states for every fetch, and manually clearing/refreshing them.
What you are leaving on the table: You already have React Query (@tanstack/react-query) installed in App.jsx, but you aren't using it in your pages.
React Query automatically caches API responses.
It eliminates all manual loading/error states, handles background updates, and automates revalidation (e.g., refreshing list queries automatically when a save mutation succeeds).
Loss: Faster page transitions and cleaner code (you could delete ~200 lines of boilerplate state logic per page).
2. Component Modularity & DRY Principle (Don't Repeat Yourself)
What you are doing: Writing huge components where tables, modals, input elements, and buttons are defined inline using long Tailwind strings.
What you are leaving on the table: Reusable UI components.
Loss: If you want to change the visual styling of your form inputs, you have to find and modify dozens of .glass-input strings across 10 different files instead of updating a single <Input /> component.
3. Type Safety (TypeScript)
What you are doing: Relying on pure JavaScript.
What you are leaving on the table: Compile-time safety. For a business ERP handling numeric data, budgets, statuses, and multi-actor roles, TypeScript would guarantee that you never accidentally pass an undefined variable, access a missing property, or misspell a role name.
Loss: IDE autocompletion for database structures and instant error flags before you even open your browser.
4. Database Isolation in Testing
What you are doing: Running tests directly against your live Supabase database instance.
What you are leaving on the table: Local/mocked test databases.
Loss: If a test crashes mid-execution before its cleanup step runs, it leaves trash rows in your database. Additionally, you cannot run tests offline, and concurrent test runs can cause unique constraint conflicts.
5. Automated Linting & Formatting (ESLint / Prettier / Husky)
What you are doing: Manually checking that code looks correct and writing git commits directly.
What you are leaving on the table: Pre-commit hooks.
Loss: Automatic checks that format code and block git commits if there are syntax errors, unused imports, or failing tests.

