---
description: Request a read-only Aqua code review of specified files or a supplied diff
agent: aqua-review
subagent: true
---

Review $ARGUMENTS against Aqua's repository instructions. Identify concrete bugs,
data-boundary mistakes and missing regression evidence. Return severity and
file:line for each finding. Do not edit files or execute commands.
