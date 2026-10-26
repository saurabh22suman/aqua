# Aqua documentation

Start here. This index separates maintained operating guidance from dated plans
and evidence; an old checkbox or audit is not proof of current behavior.

## What governs current work

1. Latest human task and [root agent instructions](../AGENTS.md).
2. [Product scope](project-scope.md), [architecture](architecture.md), and the
   task's relevant [implementation-plan](implementation-plan.md) sections.
3. [DESIGN.md](../DESIGN.md) for UI; [current design entry point](ui-redesign-implementation-plan.md)
   records the two selected themes, not a completed design implementation.
4. [OpenCode development](opencode-development.md) and [DB rules](../db/CLAUDE.md)
   for setup and data work. Verify versions against package.json/lockfile.

Read the sections relevant to the assignment; do not load every historical
report or treat archived setup commands as current prerequisites.

## Maintained operating and verification guides

| Need | Read |
| --- | --- |
| Deploy, backup, recovery | [Deployment](deployment.md) |
| Pilot release gates | [Pilot release checklist](pilot-release-checklist.md) |
| Pilot audit/monitoring procedure | [Operations runbook](pilot-operations-runbook.md) |
| Demo walkthrough | [Demo runbook](demo-runbook.md), [WhatsApp flows](whatsapp-demo-flows.md) |
| Tests and CI | [Testing strategy](testing-strategy.md), [CI guide](ci-first-run.md), [.github workflow](../.github/workflows/ci.yml) |
| Review and authorization | [Review checklist](review-checklist.md), [guard matrix](guard-path-matrix.md) |
| Repository protection | [Protection verification record](branch-protection.md); recheck live state before relying on it |
| Agent setup | [OpenCode development](opencode-development.md), [agent onboarding](agent-onboarding.md) |
| Messaging roadmap | [Post-pilot messaging](messaging-post-pilot.md) |

## Plans and unresolved work

- [Implementation plan](implementation-plan.md) and [five-phase work guide](five-day-work-guide.md)
  contain task and dependency history; confirm current acceptance and branch rules.
- [Pilot remediation](pilot-remediation-checklist.md), [October fixes](review-fixes-status.md)
  and dated remediation ledgers retain unresolved work and verification limits.
- [RED proposals](red-proposals.md) includes both adopted decisions and open
  questions. Read the status of each section; do not reopen implemented items.
- [Ops platform design](ops-platform-design.md) is a proposal/decision trail.
  Adopted tasks are recorded in the implementation plan and code.

## Evidence and historical material

- [Audits](audits/): findings against named dates/revisions, not current truth.
- [Archive](archive/README.md): superseded setup/deployment/design plans and
  historical snapshots. Retained for decisions, task IDs and audit traceability.
- `images/`, `design/owner-ui-preview/`, `sports-club-ui-direction.html` and
  `how-it-works.html`: reference/preview material; not the running application.
  Preserve user references and useful screenshots until replacement is approved.
- Local `handoffs/`, when present, describe ongoing uncommitted work. A handoff
  does not outrank the latest human instruction or establish merge readiness.

## Keep documentation useful

Keep one current guide per subject. When replacing it, archive the prior version,
update incoming links and add a short compatibility pointer only where old
references need it. Preserve active runbooks, safety requirements and unresolved
findings. Do not delete evidence just because it is old. Never record credentials
in documentation or certify a live operation from a source-only review.
