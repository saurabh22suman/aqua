# Five-day batch — handover prompt

Paste this into a fresh session to start the control-plane and onboarding batch.
main contains branded IDs (PR #29), CI green. Full task list — 42 days-1-5 + 35
reserve — is in `docs/five-day-work-guide.md`.

## Read, in this order

1. **`CLAUDE.md`** at repo root (lands with PR #1; if missing, `docs/agent-setup.md` §3).
2. **`docs/agent-onboarding.md`** — full. "Never do this" list and access invariants.
3. **`DESIGN.md`** and **`docs/sports-club-ui-direction.html`** — both, before any screen.
4. **`docs/agent-lanes.md`** — pick your lane before opening an editor.
5. **`docs/five-day-work-guide.md`** — task list. Days 1–5 ordered; reserve R.1–R.35.
6. **`docs/review-checklist.md`** — satisfy it before opening the PR if you can.
7. **Per task:** `db/CLAUDE.md`, `docs/testing-strategy.md §"Tier 1"`, the architecture
   section the task names, the task's `Read first:` line if it has one.

## Working method

- **Batch PRs by coherent unit.** Aim for 8–12 PRs across the five days. Each task
  within a batch still gets full TDD and CI — batching is about review capacity,
  not rigour.
- **Rebase on main** before opening a batch.
- **TDD.** Test red before implementation, every time.
- **Test the test.** Break the implementation, confirm red, restore.
- **Mark the checklist** in `five-day-work-guide.md` as you complete each task.

## Mechanically enforced vs depends on you

| Safe to forget (the system stops you) | Not safe to forget (only you will) |
|---|---|
| RLS — `pg_class` sweep + mutation gate, CI-blocked | DESIGN.md composition (only caught on read) |
| Money chain — schema + lint will stop you | Empty state with verb CTA on every list |
| `tests/tier1/**` ownership — AST walk guards it | Sibling-hunt on every bug (below) |
| `db/migrations/` lane separation — `agent-lanes.md` blocks it | RED-while-waiting (no idling, no building anyway) |
| Raw `db/client` outside `db/` — `no-restricted-paths` | Reserve ordering — your call, not the system's |

**Shape of an enforced thing:** lint rule, CI gate, migration-ledger invariant, AST walk.
**Shape of a remembered thing:** habit, re-read, manual sweep before opening the PR.

## Hard boundaries — all nine

1. No money work (plans, subscriptions, invoices, payments, WhatsApp).
2. Never invent a business rule — propose and wait.
3. Never merge your own code or schema PR — the human merges.
4. No new dependency without asking.
5. Never edit `tests/tier1/**` (the fifteen canonical files).
6. Never weaken a lint rule, a test, or a CI gate.
7. Never build a RED task before its proposal is approved.
8. Never touch `db/migrations/` from a UI-lane branch.
9. Never invent work after the reserve is exhausted — follow `five-day-work-guide.md`
   §"When the reserve is exhausted" instead.

## When blocked

Two genuine attempts, then stop. Write what you tried and what you need. Move to the
next independent task. Never guess a product decision.

**RED-while-waiting:** hit a RED task, write the proposal, move to the next GREEN task.
Do not idle, do not build it anyway. Note it in the daily report.

## Sibling hunt — seven for seven

When you find a bug, search for a second instance of the same shape **before closing**.
Seven for seven so far — every recurrence has been real. Known shapes:

- Parse/permission preamble skipped in a Server Action (3).
- Row-level scope on a list but not on its direct-access sibling (1).
- Unit test that fabricated `ctx` and missed a real-resolution bug (1).
- Verification by literal-string grep that missed a sibling reached by relative import (1).
- Offline-durability "fix" that read as fixed on one green run, was a third undiagnosed
  mechanism (1).

A bug found and a sibling queued for "future work" is the recurrence, not the fix. Fix
the sibling before closing the task.

## Daily report

```
DAY N

Completed:      task ids, PR numbers, CI status
Blocked:        task id, what you tried, what you need
Bugs found:     each one, and whether you checked for a sibling
Deferred:       what and why
Scope drift:    anything you noticed but did not act on
Tomorrow:       what you intend to start
```

One per day. No code without a daily report.

## After the reserve

When every R.1–R.35 is checked off, stop. Follow `five-day-work-guide.md` §"When the
reserve is exhausted" — checklist run, independent review with mutations, sibling hunt
on the last two weeks of bugs, doc reconciliation, missing integration tests, then
STOP and report. Do not start speculative work.
