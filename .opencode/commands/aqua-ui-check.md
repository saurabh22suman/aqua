---
description: Independent Aqua browser acceptance check in a local or preview environment
agent: aqua-browser-qa
subagent: true
---

Check $ARGUMENTS against DESIGN.md and the approved acceptance contract. Use the
provided local/preview URL, isolated browser and required viewports. Save evidence
under .playwright-mcp. Report unverified states and blocked prerequisites; do not
edit application code or mutate data outside the authorized test scope.

Load aqua-ui-quality and follow docs/ui-quality-contract.md, including long-page
scroll and short-height checks for shell/nav changes. Report functional and
visual acceptance separately, with exact branch/artifact identity. No PASS when
required browser scenarios are missing or the human-facing app still differs.
