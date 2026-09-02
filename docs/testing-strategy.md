# Testing strategy — Aqua

**How to verify agent-written code actually works.**

| | |
|---|---|
| Document | Testing strategy |
| Applies from | Task S-01 |
| Companions | `implementation-plan.md`, `architecture.md`, `agent-setup.md` |

---

## 1. The problem this solves

Normal test suites catch regressions. This one has a different job: **it is the only verification an agent cannot talk its way around.**

An agent can produce code that typechecks, lints, builds, and is wrong. It will say "done" with complete confidence. Three specific failure modes:

**1. The agent writes the code and the tests, so both encode the same misunderstanding.** If it misread the spec, the test asserts the misreading. Everything is green.

**2. Coverage is gameable, and agents optimise for what is measured.** Generated suites tend to aim at coverage while skipping meaningful assertions — a test that calls a function but only checks the result is non-null contributes coverage and verifies nothing. One documented case: a file reporting 100% statement coverage and 75% branch coverage had no direct unit tests, and mutation testing found 13 surviving mutants.

**3. Mocks hide the things that matter here.** Row-level security, exclusion constraints, gapless sequences and concurrent writes are database behaviours. A mocked database always agrees with you.

The strategy that follows is built on three responses: **test against a real Postgres**, **measure test quality rather than coverage**, and **have a human own the tests for the two things that cannot be got wrong**.

---

## 2. Tiers — do not test everything equally

Uniform coverage targets waste effort on trivia and under-test the things that end the company.

| Tier | Scope | Standard |
|---|---|---|
| **1 — Unrecoverable** | Tenant isolation · money arithmetic · invoice numbering · payment idempotency · consent for minors | **Human writes the test from the acceptance criteria before implementation.** Mutation gate. Agent may never edit these files |
| **2 — Expensive to get wrong** | Entitlement resolution · offline attendance replay · booking overlap · payout computation · pre-debit guard · permissions | Agent writes, human reviews. Mutation gate |
| **3 — Everything else** | CRUD, screens, reports, imports | Agent writes. Normal review. No mutation gate |

**Tier 1 is exactly these fifteen test files.** That is the human review budget for the entire project, and it is affordable precisely because it is small. Each file is born with its owning task; `guard.sh`'s read-only glob over `tests/tier1/**` is harmless until then.

| # | File | Created with |
|---|---|---|
| 1 | `isolation-hostile.test.ts` | F-08 |
| 2 | `rls-enabled-and-forced.test.ts` | F-08a |
| 3 | `connection-role.test.ts` (`current_user`) | F-08 |
| 4 | `money-properties.test.ts` | C-28a |
| 5 | `invoice-numbering-gapless.test.ts` | C-31 |
| 6 | `invoice-gst-arithmetic.test.ts` | C-32 |
| 7 | `partial-payments.test.ts` | C-33 |
| 8 | `webhook-idempotency.test.ts` | C-37/C-38 |
| 9 | `refunds-credit-notes.test.ts` | V-17 |
| 10 | `consent-minor-block.test.ts` | C-05 |
| 11 | `consent-withdrawal-immutable.test.ts` (record immutable; suppression per-purpose; essential messages still send) | V-45 |
| 12 | `predebit-notice-guard.test.ts` | V-15a |
| 13 | `mandate-optout-cycle.test.ts` | V-15a/V-16 |
| 14 | `pay-permission-audit.test.ts` | V-33a |
| 15 | `magic-link-scope.test.ts` (a fee link cannot read progress) | C-44 |

---

## 3. The stack

| Tool | Role | Why this one |
|---|---|---|
| **Vitest** | Runner | Fast, native TS/ESM, same config as the build |
| **Testcontainers** (`@testcontainers/postgresql`) | Real Postgres per suite | **Non-negotiable.** RLS, exclusion constraints and concurrency cannot be tested against a mock or SQLite |
| **fast-check** | Property-based testing | Money invariants across randomised input — where agents fail on edge cases |
| **Stryker** | Mutation testing | Measures whether tests would notice a bug. Cannot be gamed by executing code |
| **Playwright** | E2E on critical journeys | Also available to the agent as an MCP server, so it can verify its own UI |
| **MSW** | Razorpay and WhatsApp stubs | Contract-level, no live calls in CI |
| **Lighthouse CI + bundlesize** | Performance budget | Already in the plan at S-05 |
| **jsdom + @testing-library/react** | Component/hook behaviour | Added for issue #4 (see §3.3) — the first tests in this repo that render React |

### 3.1 Why Testcontainers rather than a mock

This is the single most important choice in this document.

`isolation.test.ts` asserts that a hostile query targeting another tenant's id returns nothing. That behaviour lives in a Postgres RLS policy. Against a mocked client the test passes whether or not RLS exists — it is worse than no test, because it produces confidence.

The same applies to the booking exclusion constraint, gapless invoice numbering under concurrency, and `force row level security`. SQLite is not a substitute either: <cite>SQLite has a different SQL dialect, transaction semantics and concurrency behaviour, and bugs that pass against it routinely fail in production.</cite>

```ts
// tests/support/db.ts
import { PostgreSqlContainer } from '@testcontainers/postgresql';

export async function startTestDb() {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withCommand(['postgres', '-c', 'fsync=off'])   // faster, safe for tests
    .start();
  await runMigrations(container.getConnectionUri());
  return container;
}
```

Two practical notes: give `beforeAll` a generous timeout (60s) because the first run pulls the image, and enable container reuse locally so the inner loop stays fast. In CI, Docker is already available on GitHub Actions runners.

**Speed pattern:** start one container per suite, migrate and seed once, then wrap each test in a transaction and roll back. Real database behaviour at near unit-test speed, with no cleanup code and no state leaking between tests.

### 3.2 Mutation testing — the anti-gaming gate

Coverage tells you which lines ran. Mutation testing changes the code and checks whether any test notices.

```bash
pnpm add -D @stryker-mutator/core @stryker-mutator/vitest-runner
npx stryker init
```

**Target 60–70% mutation score on Tier 1 and Tier 2 modules only.** Not the whole codebase — Stryker is slow, and the score on CRUD screens tells you nothing worth the runtime.

In pull requests, mutate only changed files:

```bash
npx stryker run --incremental \
  --mutate "$(git diff --name-only origin/main -- 'lib/money/**' 'db/**')"
```

`--incremental` reuses prior results, which makes this affordable on every PR rather than nightly.

**This is the metric to watch, because it cannot be faked by a model optimising for line coverage.** A surviving mutant is a direct measurement of a test that verifies nothing.

### 3.3 Component/hook testing — jsdom + @testing-library/react

Added while fixing issue #4 (a real, twice-confirmed data-loss bug in offline attendance sync), not before — this repo had zero component or hook tests until then, deliberately: `vitest.config.ts`'s default `environment: "node"` is faster for everything that doesn't need a DOM, which is most of this codebase. `mark()` (`lib/hooks/use-offline-register.ts`) fired its write inside a detached, unawaited async IIFE — proving that behaviourally (not just by reading the code) required actually rendering the hook and asserting on the promise it returns, which needs a DOM. Structural checks (grepping for the anti-pattern's shape, or an AST walk like `server-action-preamble.test.ts`'s) were considered and rejected for this specific bug: they prove the code doesn't *look* like the bug, not that the behaviour is correct, and a refactor reintroducing the same defect in a different shape would pass clean. See `tests/offline/use-offline-register.test.tsx` for the pattern.

**How to use it:** put `// @vitest-environment jsdom` as the first line of a test file to opt that file alone into a DOM — the rest of the suite stays on the fast `node` environment. Use `@testing-library/react`'s `renderHook`/`act` for hooks; nothing here is React-Testing-Library specific about *how* to write assertions, only about how to get a hook running at all outside a real page.

**When to reach for it:** Tier 1/2 UI behaviour that a structural check would only prove the shape of, not the behaviour — exactly the class of bug F-08a's own limitation entry in `docs/review-checklist.md` describes for RLS. Prefer this over a structural/AST check whenever the thing that matters is what the code *does* at runtime, not what it looks like. This repo has roughly 130 tasks remaining, mostly UI-facing — this capability exists now specifically so it's available deliberately, not added in a hurry under a future deadline.

---

## 4. The tests that matter

### 4.1 Tenant isolation — the CI gate

Already task F-08. Nothing proceeds until it passes.

```ts
test('a hostile cross-tenant query returns nothing', async () => {
  const a = await createTenant(), b = await createTenant();
  await seedMembers(b.id, 10);

  const explicit = await withTenant(a.id, (tx) =>
    tx.execute(sql`select * from members where tenant_id = ${b.id}`)
  );
  expect(explicit.rows).toHaveLength(0);
});

test('RLS is enabled AND forced on every tenant-scoped table', async () => {
  const rows = await adminDb.execute(sql`
    select relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and (not c.relrowsecurity or not c.relforcerowsecurity)
      and relname not in (${sql.join(PLATFORM_TABLES)})
  `);
  expect(rows.rows).toEqual([]);
});
```

The second test is the one that scales. It catches every future table the agent adds without RLS, without anyone remembering to write a test for it.

### 4.2 Money — property-based

Example-based tests check the cases you thought of. Agents fail on the ones you didn't.

`splitTotal` takes `(total, basisPoints)` — **2 args, not 3.** An earlier draft of this section showed a 3-arg `splitTotal(total, base, bp)`; that was illustrative pseudocode, never a real signature, and the actual `lib/money` implementation (C-28) correctly didn't follow it: passing `base` alongside `total` invites a caller to pass an inconsistent pair. `splitTotal` derives `base` itself and computes `tax` as the remainder (`total - base`), which is what guarantees `base + tax === total` exactly, always — including for totals that aren't reachable by any exact `(base, bp) → total` forward computation, since `computeTax` rounds and not every total has a unique pre-image.

```ts
import fc from 'fast-check';

test('tax and total never lose precision', () => {
  fc.assert(fc.property(
    fc.integer({ min: 1, max: 100_000_00 }),   // paise
    fc.integer({ min: 0, max: 2800 }),         // basis points
    (base, bp) => {
      const tax = computeTax(base, bp);
      const total = base + tax;
      expect(Number.isInteger(tax)).toBe(true);
      expect(total).toBeGreaterThanOrEqual(base);
      // base + tax === total holds unconditionally by construction.
      // Exact match to the ORIGINAL base only holds where the forward
      // computation is uniquely invertible — decide whether to assert
      // exact equality here (and restrict the generator to avoid
      // rounding-boundary cases) or accept a documented tolerance.
      const { base: recoveredBase, tax: recoveredTax } = splitTotal(total, bp);
      expect(recoveredBase + recoveredTax).toBe(total);
    }
  ), { numRuns: 1000 });
});

test('partial payments always sum to the invoice total — normal branch', () => {
  fc.assert(fc.property(
    fc.integer({ min: 100, max: 500_000 }),
    fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 12 }),
    (total, payments) => {
      const sumPayments = payments.reduce((a, b) => a + b, 0);
      fc.pre(sumPayments <= total); // this property only, not the overpay branch below
      const inv = applyPayments(total, payments);
      expect(inv.paid + inv.outstanding).toBe(total);
      expect(inv.outstanding).toBeGreaterThanOrEqual(0);
    }
  ), { numRuns: 1000 });
});

test('partial payments — overpayment branch is a SEPARATE property, not folded into the one above', () => {
  // paid + outstanding does NOT equal total here: outstanding clamps
  // at zero and paid can exceed total. A single blanket equality
  // across both branches will falsely fail on generated overpayment
  // cases — this is exactly the shape of bug this section exists to
  // catch, so don't let the test itself repeat it.
  fc.assert(fc.property(
    fc.integer({ min: 100, max: 500_000 }),
    fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 12 }),
    (total, payments) => {
      const sumPayments = payments.reduce((a, b) => a + b, 0);
      fc.pre(sumPayments > total); // overpay only
      const inv = applyPayments(total, payments);
      expect(inv.outstanding).toBe(0);
      expect(inv.paid).toBe(sumPayments);
    }
  ), { numRuns: 1000 });
});
```

### 4.3 Concurrency — where mocks lie hardest

```ts
test('fifty parallel invoices produce fifty gapless numbers', async () => {
  const results = await Promise.all(
    Array.from({ length: 50 }, () => createInvoice(tenant.id, location.id))
  );
  const nums = results.map(r => parseInt(r.invoiceNumber, 10)).sort((a,b) => a-b);
  expect(new Set(nums).size).toBe(50);
  expect(nums.at(-1)! - nums[0]).toBe(49);   // no gaps
});

test('fifty identical booking attempts yield exactly one success', async () => {
  const attempts = await Promise.allSettled(
    Array.from({ length: 50 }, () => createBooking(SAME_SLOT))
  );
  expect(attempts.filter(a => a.status === 'fulfilled')).toHaveLength(1);
});
```

### 4.4 Idempotency

```ts
test('a webhook replayed five times applies one payment', async () => {
  const event = razorpayCapturedEvent({ invoiceId: inv.id, amount: 300000 });
  for (let i = 0; i < 5; i++) await postWebhook(event);
  await drainJobs();

  expect(await countPayments(inv.id)).toBe(1);
  expect(await countMessages('receipt', inv.memberId)).toBe(1);
});

test('offline attendance replays without duplicating', async () => {
  const marks = buildMarks(16);
  await replayQueue(marks);
  await replayQueue(marks);   // reconnect fired twice
  expect(await countAttendance(session.id)).toBe(16);
});
```

### 4.5 The guards that are easy to regress

```ts
test('a debit cannot execute without a recorded pre-debit notice', async () => {
  const sub = await createSubscriptionWithMandate();
  await expect(executeDebit(sub.id)).rejects.toThrow(/notice/i);
});

test('opting out cancels one cycle, not the membership', async () => {
  await optOut(notice.id);
  await runDebitJob();
  expect(await getSubscription(sub.id)).toMatchObject({ status: 'active' });
  expect(await countDebits(sub.id)).toBe(0);
});

test('a substituted session pays the substitute', async () => {
  await substituteCoach(session.id, substitute.id);
  const run = await computePayouts(month);
  expect(lineFor(run, substitute.id).quantity).toBe(1);
  expect(lineFor(run, original.id)).toBeUndefined();
});

test('a receptionist cannot read pay data and the attempt is audited', async () => {
  await expect(getPayoutLines(receptionistCtx, run.id)).rejects.toThrow(Forbidden);
  expect(await lastAudit()).toMatchObject({ action: 'staff.pay.read.denied' });
});
```

### 4.6 E2E — critical journeys only

Five Playwright specs, not fifty. Slow, brittle, expensive to maintain — spend them where failure is invisible in unit tests.

1. Coach marks a full register offline, reconnects, marks persist
2. Parent opens a magic link, pays by UPI, receipt arrives
3. Receptionist logs an enquiry → trial → conversion to member
4. Owner runs a payout: draft → adjust → approve → locked
5. Walk-in books a pool slot on the public page and pays

Use role-based and accessibility selectors, never CSS classes — the agent will restyle components constantly and class-based selectors will break every week.

---

## 5. Rules for agent-written tests

These are enforcement, not guidance.

| Rule | Enforcement |
|---|---|
| **Tier 1 test files are read-only to the agent** | `guard.sh` blocks edits to `tests/tier1/**` |
| **Never disable, skip or `.only` a test to make a gate pass** | Lint rule bans `.skip` and `.only`; CI fails on either |
| **Tests are written before implementation for Tier 1 and 2** | Task order in the plan; `execute-task` skill enforces |
| **No mocking the database** | `guard.sh` blocks `vi.mock` on any `db/` path |
| **Assertions must check values, not existence** | Mutation gate catches `toBeDefined()` theatre |
| **A test that has never failed is suspect** | Break the code deliberately; confirm the test goes red |

That last one is the cheapest habit with the highest return. When the agent reports a passing test, delete a line of the implementation and re-run. If it still passes, the test is decoration.

---

## 6. CI pipeline

What this repo actually runs today — transcribed from
`.github/workflows/ci.yml`, not a designed-but-unbuilt pipeline:

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  ci:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        # ... env, ports, healthcheck, MIGRATION_DATABASE_URL setup ...
    env:
      DATABASE_URL: postgresql://app_login:ci-only-app-pw@localhost:5432/aqua
      MIGRATION_DATABASE_URL: postgresql://aqua:aqua@localhost:5432/aqua
      APP_LOGIN_PASSWORD: ci-only-app-pw
      NODE_ENV: test
      BETTER_AUTH_SECRET: ci-build-only-not-a-real-secret
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm check:migrations                       # M1: filename/ordering
      - run: pnpm exec tsx scripts/check-lane-overlap.ts # M2: non-blocking
      - run: pnpm db:reset                              # bootstrap roles + migrate
      - run: pnpm test                                  # vitest, all tiers
      - run: pnpm exec tsx scripts/check-bundle-budget.ts
      - run: pnpm exec tsx scripts/check-font-budget.ts
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm seed                                  # demo-academy fixture
      - run: pnpm exec tsx scripts/e2e-offline.ts        # S3 sync, six VERIFYs
      - run: pnpm exec tsx scripts/e2e-offline-disabled.ts # online-only counterpart
```

Two things this list does not contain that the previous version
claimed:
- `pnpm lint --max-warnings=0` — `pnpm lint` is run, but **without
  `--max-warnings=0`**. Known gap; fix in flight.
- `pnpm test:unit` / `pnpm test:integration` / `pnpm test:isolation`
  — there's a single `pnpm test`. The `vitest.config.ts`
  `fileParallelism: false` is what keeps the cross-file state-sharing
  test files (which currently live in `tests/tier1/**`) from racing.
  Tier-1 isolation tests that need disposable Postgres use
  Testcontainers spun up inside the test itself, not a separate
  npm script.

`scripts/e2e-offline.ts` and `scripts/e2e-offline-disabled.ts` are
the only test-time scripts not part of the standard `pnpm test` run.
They live in `scripts/` because they need a real dev server and a
real Chromium — both are heavier than what vitest is set up for.
Their timing-sensitive failure mode (VERIFY 5) is the documented
exception; everything else either passes deterministically or
points at a real bug.

**The pipeline must be able to say no.** An agent that can merge
past a red CI has no guardrails at all. Today that gate is enforced
by `gh`'s merge queue respecting the `ci` status check (combined
with the standing rule that nothing merges without an explicit
human-issued `gh pr merge`); see `docs/branch-protection.md` for the
runbook to convert that discipline rule into a platform-level
guarantee.

---

## 7. Tasks in the implementation plan

All five verification tasks referenced by this document exist in `implementation-plan.md`:

| Task | Where | Content |
|---|---|---|
| **S-05a** | Setup, after S-05 | Testcontainers harness, transaction-rollback fixture, seed factories |
| **S-05b** | Setup, after S-05a | Stryker config, thresholds, incremental mode, `mutate:changed` script |
| **F-08a** | Phase 1, after F-08 | Catch-all RLS-enabled-and-forced assertion over `pg_class`, plus the `current_user = app_user` connection assertion |
| **C-28a** | Phase 2, after C-28 | fast-check property suite for money |
| **V-33a** | Phase 3, after V-33 | Pay permission and audit-on-read tests |

---

## 8. What not to do

| Avoid | Why |
|---|---|
| A global coverage target | Agents optimise for it and produce assertion-free tests |
| Snapshot tests on components | Restyling churns them constantly; the agent regenerates them without reading |
| Mocking Postgres | Defeats the purpose of every test that matters here |
| E2E for everything | Slow, flaky, and the agent will disable them when they block it |
| Letting the agent write Tier 1 tests | The code and the test would share one misunderstanding |
| Mutation testing the whole repo | Runtime cost with no signal on CRUD |
| AI-detection tools to spot generated code | Unreliable, false-positive prone. Gate on evidence of correctness instead |
