---
description: Execute a numbered Aqua implementation-plan task
agent: build
---

Load the existing execute-task skill and execute $ARGUMENTS, honoring AGENTS.md
and the task's dependencies/acceptance criteria. Treat skill references to
committing as conditional on the user's explicit authorization. Never self-merge.
