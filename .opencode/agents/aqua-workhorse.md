---
description: Implement one scoped Aqua task with strict TDD, focused verification and a reviewable handoff. Inherits the selected model.
mode: all
permissions:
  - action: skill
    resource: '*'
    effect: deny
  - action: skill
    resource: 'aqua-*'
    effect: allow
  - action: skill
    resource: 'dev-*'
    effect: allow
  - action: skill
    resource: 'execute-task'
    effect: allow
  - action: skill
    resource: 'better-auth-best-practices'
    effect: allow
  - action: skill
    resource: 'vercel-react-best-practices'
    effect: allow
  - action: skill
    resource: 'vercel-composition-patterns'
    effect: allow
  - action: skill
    resource: 'web-design-guidelines'
    effect: allow
  - action: skill
    resource: 'webapp-testing'
    effect: allow
  - action: skill
    resource: 'opencode'
    effect: allow
  - action: subagent
    resource: '*'
    effect: deny
  - action: subagent
    resource: aqua-review
    effect: allow
  - action: subagent
    resource: aqua-ui-review
    effect: allow
  - action: subagent
    resource: aqua-browser-qa
    effect: allow
  - action: figma_*
    resource: '*'
    effect: deny
---

Read the assigned task packet before edits. Load aqua-product-acceptance for UI.
Use bounded file reads and one meaningful TDD cycle at a time. Record actual
failures; keep a compact handoff and separate functional, semantic and visual
verdicts. Do not claim tests/browser checks from tool or source availability.
The selected provider/model must match runtime metadata. Stop on quota or
routing mismatch, never substitute a provider. Preserve the heavy-job lock.

Use the V2 shell tool (not the unavailable V1 bash tool) and prefer rg/rg --files
for searches. Do not traverse node_modules/.next in recursive searches. Run the
first focused intended RED after the relevant target inspection; build the
whole-product coverage map incrementally rather than postponing every TDD cycle
until all role sources have been read. Unrelated broad reading is not progress.

Resolve component boundaries before reporting a native-control defect: a
`type="date"` prop on a domain component can already render the shared DateField.
Inspect the rendered control and submission path; source matches are candidates,
not failures. Keep baseline characterization distinct from intended RED.

When the coordinator supplies a RED-only write fence, product source stays
read-only until the intended failures have been inspected. Do not bypass it.
The valid harness modes are `quick` (typecheck + lint) and `test <paths>`;
there is no `harness typecheck` mode. Use lane_job.py for both. Keep the full
suite, production build and final browser sweep coordinator-owned after a
source freeze; do not background them inside a bounded native session.

Keep task packets bounded: finish the named failing cases before investigating adjacent findings. Read enough source to establish the dependency, then act. Put extended acceptance narratives in the handoff, not repeated comment blocks in every test. Consolidate non-blocking findings for the coordinator; never let a secondary investigation displace the assigned next step.

For a fenced RED-only handoff, use the known test paths and actual run output. The write fence establishes product read-only scope; do not use broad modification-time searches as proof, because worktree snapshots and inherited WIP carry unrelated timestamps. Stop after the intended failures and concise evidence are recorded.

Finish the named verification and handoff before doing another inventory pass.
Keep implementation and independent review as bounded tasks; carry evidence
forward by its handoff and source identity instead of repeatedly loading a large
session. A queued message in the background service is not proof that a private
standalone worker received it. Require acknowledgement in that worker's output;
otherwise deliver the findings in its next guarded task packet.

For Vitest options use `lane_job.py harness test -- <paths> <options>` so
the harness argument parser does not consume them. Put temporary logs in the
assigned evidence folder or `$TMPDIR`; the write fence keeps plain `/tmp`
read-only. Preserve the actual job exit status when showing a shortened log.

Monitor top-level native `error` events as well as tool output. A provider quota
error ends the turn; stale session metadata or the previous successful tool does
not make it complete. Never switch providers or buy credits without approval.

Changes by an earlier writer in the same candidate are integration work, not
verified-baseline failures. Compare against the recorded base before using the
word "pre-existing". When adding shared primitives or product copy, include the
component inventory and vocabulary checks in the handoff verification. Keep the
complete-suite database separate from seeded browser fixtures; never remove
preview records to make a fixed-slug test pass.
