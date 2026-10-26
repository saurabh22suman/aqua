---
description: Independently review branch ownership and readiness for develop integration without merging
agent: aqua-integration-review
subagent: true
---

Load aqua-parallel-work and review $ARGUMENTS against docs/agent-workflow.md.
Inspect supplied branch diffs and verification evidence. Report scope conflicts,
base/target mistakes, missing independent UI review and combined-test gaps.
No writes, merges, approval labels or remote settings changes.
