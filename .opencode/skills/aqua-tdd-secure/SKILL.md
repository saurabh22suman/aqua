---
name: aqua-tdd-secure
description: Enforce strict red-green-refactor TDD, secure SDLC and SOLID for all Aqua implementation and refactoring. Use before any production behavior change, UI interaction, backend service or PWA work; record actual failing and passing evidence.
---

Read docs/engineering-standard.md and the task acceptance first. New behavior
requires an observed intended failing test BEFORE implementation, then smallest
passing code, then refactoring with tests green. Infrastructure/import failures
are not RED. Do not invent historical evidence for inherited code.

Choose meaningful tests at the layer that can detect the failure: pure logic,
scoped DB/service boundaries or rendered browser interaction/geometry. Use
agent-owned test files; do not alter tests/tier1/** without human authorization.
Preserve disposable DB and exact artifact verification rules.

Record data/roles/trust boundaries and abuse cases before coding. Preserve tenant
and location access, validation, transactional audits, bigint money, offline
identity/expiry/logout and parent zero-JS/no-store. Review pinned dependencies,
negative tests and independent security/code review. No automatic waiver of
baseline failures or claim of certification.

Apply SOLID with small typed interfaces and shared primitives, not speculative
classes/factories. Handoff contains acceptance, RED command/assertion/output,
GREEN evidence, refactor checks, security implications, baseline/new failures,
files changed, scope exclusions and remaining review gates. Setup/docs-only work
uses document/config validation; it is not application implementation TDD.
