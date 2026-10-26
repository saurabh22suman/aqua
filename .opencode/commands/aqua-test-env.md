---
description: Prepare the checkout's separate disposable local test database without changing the dev club
agent: build
---

Load aqua-verification. Run `python3 .opencode/scripts/harness.py prepare-test`.
If the default port is owned, inspect Docker/ports and choose a free explicit
`--port` instead. Never replace root .env, delete an existing container or reseed
the development club. Report readiness without printing credentials.
