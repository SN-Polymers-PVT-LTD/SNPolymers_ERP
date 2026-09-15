# ERP Senior Review

Use this skill for review or readiness assessment.

## Review order

Check authorization/data exposure; accounting, capacity, and workflow invariants; migration safety; concurrency/idempotency; response-shape compatibility; frontend/backend alignment; regression coverage; and maintainability/UX.

Prioritize findings as P0/P1/P2/P3. Cite concrete files or reproducible behavior. Distinguish blockers from cleanup and do not invent findings merely to lengthen the review.

Verify claims against the current checkout. For database behavior, use local Supabase and inspect effective migrations/RPCs. For frontend behavior, trace the complete parent-page flow rather than reviewing an isolated component.

Lead with the verdict, then list findings with severity, impact, evidence, and recommended fix. End with tests run and remaining risks.
