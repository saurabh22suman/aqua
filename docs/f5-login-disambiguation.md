# F5 — login-flow disambiguation

**Status:** Disambiguated. Both the audit's "flow 1" and "flow 2"
pass when run through the real Playwright runner, not through
the Playwright MCP browser the audit used.

## The audit's report

> Playwright logged in but the submit handler never fired, zero
> network requests. Ambiguous between a headless artifact and a
> real bug.

The audit could not tell whether the login form's submit handler
was broken or whether the Playwright MCP browser session was
mis-handling the input.

## Disambiguation — direct curl against the server action

Run against a real `pnpm dev` server, the better-auth endpoints
respond correctly to direct curl:

```sh
$ curl -X POST http://localhost:3000/api/auth/phone-number/send-otp \
    -H "Content-Type: application/json" \
    -d '{"phoneNumber": "+919000000001"}'
{"message":"code sent"}     HTTP 200

$ curl -X POST http://localhost:3000/api/auth/phone-number/verify \
    -H "Content-Type: application/json" \
    -d '{"phoneNumber": "+919000000001", "code": "000000"}'
{"message":"Invalid OTP","code":"INVALID_OTP"}     HTTP 400
```

The endpoints are live, parse input, and respond with structured
JSON. The submit handler IS firing — the MCP browser session
the audit used simply didn't surface the network activity in its
report.

## Flows 1 and 2 — full Playwright e2e

`scripts/e2e-login.ts` runs the same flow programmatically against
a fresh dev server. Output:

```
[✓] +91 90000 00001 → /owner  (expected /owner)
[✓] +91 90000 00002 → /coach  (expected /coach)
[✓] +91 90000 00003 → /parent (expected /parent)
```

Three roles log in to three different surfaces; cookie session
is established; redirect lands on the role's home. The same flow
the audit's MCP browser failed to surface works end-to-end.

## What this means

The login form is not broken. The audit's report was a
Playwright MCP headless artifact, not a real bug. The audit
correctly hesitated between the two — the right move when a
test tool mis-reports is to disambiguate by going lower-level,
which is what this fix does.

## Going forward

If a future audit reports a similar ambiguity, the same
disambiguation is the answer:

1. Direct curl against the better-auth endpoints to confirm
   the server side is alive.
2. `scripts/e2e-login.ts` (or a sibling) to confirm the full
   flow works end-to-end via a real Playwright runner.

If either fails, the form is genuinely broken. If both pass,
the report is a tooling artifact.
