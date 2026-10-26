# Development restart checkpoint — 26 October 2026

Development is paused at the human's request. Do not start another agent batch
until asked to resume. Production and main are unchanged; integration targets
develop. PR #202 preserves the earlier owner/chart/history, theme, PWA, insight
and mock-access foundation work. The follow-up integration contains the visible
owner-home polish, mobile SVG charts, PWA prompt/update fixes, enquiry module
split, recursive service scanner and CI-runtime optimization.

## Resume safely

1. Read AGENTS.md, docs/agent-workflow.md and the latest integration PR/checks.
2. Fetch develop and inspect all existing dirty worktrees. Never reset, stash or
   overwrite a lane merely to align it with develop. Local source checkpoints
   and per-lane restart handoffs preserve work and verification evidence.
3. Start new work from the reviewed develop revision. Existing lanes must carry
   only their delta over their recorded checkpoint; do not stage the inherited
   overlay again. Keep one owner per shared file and isolated runtime profiles.
4. Use the selected minimax/MiniMax-M3.1-Flash model explicitly. Keep builds and
   full suites from competing for host resources. Recreate only deliberately
   disposable test resources if they did not survive the restart; never reset
   the club's development or production database.
5. Keep protected tests, human approval labels and main promotion under their
   existing ownership rules. No paid/hardware service activation in this phase.

## Remaining work

- Human visual acceptance of the owner homepage; compact attendance-by-batch and
  enquiry-stage entry points are not yet wired into Home. Preserve useful detail
  in Reports/Enquiries instead of adding every metric above the fold.
- Complete keyboard-menu opening/focus/Tab behavior, icon-only trigger naming and
  long-menu viewport testing. The disabled-action arrow-key trap is fixed.
- Investigate the known protected booking fixture's leaked seven-day config and
  wall-clock sensitivity; change test isolation, not the product booking policy.
- Track load-sensitive integration setup/property-test timing explicitly; do not
  skip assertions to make CI green.
- Extend update-lifecycle coverage to a worker already installing when the page
  attaches its watcher. Verify first-install and update behavior separately.
- Decide the access-control entitlement/device-authentication contract before
  exposing the internal mock gate services through any endpoint. Keep the
  dedicated gate-secret provisioning requirement explicit.
- Review existing enquiry mutation audit coverage as a separate security task;
  the module split preserves behavior and is not an audit/privacy-policy fix.
- Verify physical handset PWA installation and staging deployment/restore. Saved
  staging configuration is not a deployed or verified backup/restore claim.

CI now runs develop pushes, cancels only superseded PR runs, separates the
runtime-image contract from other checks and reuses a verified build for font
budget checking. The required ci aggregate still fails unless both lanes pass.
No measured remote duration reduction is claimed until real runs are compared.
