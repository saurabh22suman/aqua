---
name: aqua-ui-quality
description: Implement or review Aqua UI with shared-shell, scrolling, component consistency and real browser acceptance. Use for owner pages, layouts, navigation, forms, tables and charts; functional tests alone do not establish visual completion.
---

Read AGENTS.md, DESIGN.md and docs/ui-quality-contract.md. Read only relevant
role workflows and components. Do not redesign unrelated surfaces or select a
new visual direction without an assignment.

Before editing, record intended user outcome, files/shared consumers, scroll
owners, states and viewport checks. Inspect the running app and capture baseline
behavior for a reported defect. Reuse established primitives and tokens. If the
bug belongs to the shell, coordinate its one owner; never patch each page.

Implement the approved design. Verify computed layout and interactions after
hydration; missing generated CSS is not solved by piling on inline overrides.
Use aqua-verification for isolated tests/builds. Do not manipulate the human's
browser cache/offline data or stop their server merely to make evidence pass.

Execute the contract's browser matrix. For sidebar/header work, long Members
scrolling and a short desktop viewport are mandatory, with before/after viewport
captures and a geometry-based regression test. Verify route/permission parity,
focus, mobile clearance and no accidental nested/global horizontal scroll.

Return separate functional and visual results. Label each expected behavior
PASS / CHANGES REQUIRED / BLOCKED with actual URL, viewport, build identity and
evidence. If the human-facing dev server differs from the release artifact,
report the difference and cause as confirmed/unproven; do not declare it fixed.
Independent browser review is required before recommending a UI feature for
integration. A builder's self-review is supplemental, not independent approval.

For every UI behavior change load aqua-tdd-secure before implementation. The new
human-approved direction is docs/design-system/README.md; use its motion/PWA
contracts and lane ownership instead of generic animation-library suggestions.
