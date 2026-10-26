---
description: Run focused Aqua tests or the quick typecheck/lint gate safely
agent: build
---

Load aqua-verification. If $ARGUMENTS specifies test files, run
`python3 .opencode/scripts/harness.py test <those test paths>`; otherwise run
`python3 .opencode/scripts/harness.py quick`. Use only actual paths from the
request, safely quoted. Report exact results. Do not auto-resume paused work.
