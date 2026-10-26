# Aqua engineering standard

Human requirement, 26 October 2026: all development follows strict red–green–
refactor TDD, secure SDLC and SOLID principles. This governs new work; do not
invent retrospective RED evidence for inherited code. Setup/docs-only work uses
structural/link/config validation and is not falsely described as application TDD.

## Mandatory behavior-change loop

1. Define observable acceptance and security/permission constraints first.
2. RED: add the smallest meaningful regression/acceptance test and run it against
   the current implementation. Record command, intended assertion and actual
   failure. Import/setup errors or unrelated existing failures do not count.
3. GREEN: implement the smallest production change that passes that test. Do not
   write the feature first, weaken the assertion, skip the test or broaden mocks
   to manufacture green. Each independent behavior gets its own cycle.
4. REFACTOR: simplify duplication/boundaries with the relevant tests green; run
   affected checks again. Pure refactors first require coverage that detects
   behavior drift. For visual-only changes, write measurable browser acceptance
   before editing and capture its failing geometry/contrast/state evidence.
5. Verify shared consumers and the exact final artifact. Preserve fail→pass
   output summaries in the task handoff, with branch/base/dirty-diff identity.
   Tests written after implementation are supplementary, not TDD proof.

Use agent-owned tests, never tests/tier1/** without human authorization. Run DB
checks only through the reviewed disposable harness; never reset the local club.
No coverage percentage, snapshot dump or source-class assertion substitutes for
behavioral proof. Unit tests cover pure logic; integration tests cover boundaries;
browser tests cover actual rendering, keyboard, scroll and user journeys.

## Secure SDLC, proportional to the change

- Requirements: identify data touched, roles, tenant/location scope and abuse
  cases. For cache/auth/money/child-data boundaries record a short threat model.
- Design: least privilege, server authorization, input validation, safe outputs,
  audit atomicity and clear error/recovery paths; no trusting client theme/role
  values for authorization. Preserve existing threat boundaries and parent
  zero-JS/no-store behavior.
- Implementation: use approved pinned/locked dependencies; review additions for
  license, maintenance and advisory risk. No secrets in logs, screenshots or Git.
  Reuse scoped data access; money remains bigint paise, dates display in IST.
- Verification: negative tests for denied roles/cross-tenant access where changed,
  stale/expired offline identity and logout for PWA work, plus scanners and
  relevant security e2es. Review dependency-audit output without auto-fixing
  versions or ignoring findings; classify pre-existing versus introduced risk.
- Review/release: independent code and browser review, exact build evidence and
  unresolved risks reported. Feature PRs target develop; no feature self-merge,
  approval-label bypass or deployment. Human promotes tested develop to main.
- Maintenance: handoff records owner, dependencies, rollback/update behavior and
  known limitations. Never claim OWASP/NIST certification from this checklist.

## SOLID applied to TypeScript and React

- Single responsibility: page composition, visual primitives, domain services,
  persistence and cache lifecycle have separate reasons to change.
- Open/closed: extend typed variants and semantic tokens; do not scatter theme
  conditionals across pages or build speculative plugin frameworks.
- Substitution: shared controls preserve native semantics, refs, labels, disabled
  behavior and expected interaction across variants/themes.
- Interface segregation: small explicit props/capabilities; avoid giant dashboard
  objects, boolean-prop explosions and forcing clients to import server modules.
- Dependency inversion: domain logic depends on narrow contracts, not rendering
  or browser globals. Reuse existing boundaries before introducing new layers.

SOLID is not a requirement for classes, repositories around every query, generic
factories or maximum abstraction. Keep the smallest clear design that satisfies
known requirements and is testable.

References: [NIST SSDF](https://csrc.nist.gov/projects/ssdf),
[OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/).
