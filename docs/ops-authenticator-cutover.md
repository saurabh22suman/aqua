# Ops password and authenticator cutover

This change is local and has not been deployed. Keep existing `OPS_EMAIL`,
`OPS_PASSWORD`, password hashes, roles and tenant credentials unchanged.

## Before a separately authorised rollout

1. Identify every active platform operator. Confirm each has a supported
   authenticator and private access to the terminal used for enrolment. Verify
   server time synchronisation. Do not share provisioning keys through tickets,
   chat, screenshots, logs or shell arguments.
2. The configured operator must already have an active `platform_users` row.
   The login path no longer creates operators or resets database passwords.
   When the configured pair is present, its existing exclusive password policy
   remains; the database-password path applies when the pair is absent.
   Confirm this prerequisite through the existing controlled provisioning process;
   do not use the demo seed against a real database.
3. For an existing unenrolled operator, run the new terminal-only tool in a
   private interactive terminal with the intended environment loaded:

       pnpm exec tsx scripts/enrol-ops-authenticator.ts prepare operator@example.com

   Add the displayed key to the authenticator. Preparation is resumable and does
   not enable login until a real code is confirmed. It preserves password, salt
   and role. The URI/key is shown only to the local terminal; do not record it.
4. Confirm using the code through stdin, never a command-line argument. In Bash:

       read -rsp 'Authenticator code: ' ops_enrol_code
       printf '\n'
       printf '%s' "$ops_enrol_code" | pnpm exec tsx scripts/enrol-ops-authenticator.ts confirm operator@example.com
       unset ops_enrol_code

   The tool refuses unknown, suspended and already enrolled accounts. Replacing
   a lost or already enrolled key requires a separately reviewed recovery process.
   There is no public enrolment endpoint and no password/WhatsApp fallback.
5. Schedule revocation of **existing Ops sessions** with the deployment cutover.
   Old sessions carry only `second_factor_passed`; this change cannot distinguish
   an old password/WhatsApp session from a new password-plus-TOTP session.
   Without revocation, a previously authenticated Ops cookie remains usable until
   its original expiry. Revoke only `platform_sessions`, through a reviewed
   administrative transaction against the intended environment. Do not remove
   tenant sessions, browser storage, offline records or unsynchronised work.
6. Verify the reverse proxy overwrites client-supplied forwarded/real IP headers.
   IP throttling is supplemental. The persistent account limiter also works when
   no trustworthy address is available. Confirm the same stable
   `BETTER_AUTH_SECRET` is set for every app replica; rotation changes the
   pseudonymous account counter key.
7. Complete independent review, protected test approval, full serial gates and
   Chrome checks before requesting deployment approval. No step above is an
   instruction to deploy or mutate staging/production in the current task.

## Expected behaviour

A valid password creates a five-minute pending challenge. It grants no Ops read
or write authority. A valid authenticator code completes the challenge once and
starts the existing eight-hour session. A successful code cannot complete a
different password challenge, including simultaneous requests. Wait for the
authenticator to show a fresh code before another sign-in. The accepted time
step is recorded with the success audit; codes and keys are never recorded. Suspended accounts, expired challenges,
uncompleted enrolment and reused completed challenges are refused.

The old Ops WhatsApp endpoint and completion helper refuse authentication.
Tenant PIN-reset WhatsApp behaviour remains separate.

Both phases allow at most five failed attempts per account in fifteen minutes;
the additional address limit is twenty failures per phase in the same window.
Fresh challenges and separate application processes do not reset these counters.
Failure, throttling and successful phase events use the existing platform audit
log. Passwords, codes, provisioning keys, bearer tokens and raw login emails are
not written to these events. If the success audit cannot commit, the session
creation or promotion rolls back.

Ops-issued owner login and reset credentials require a current active admin.
Issuance writes platform and tenant audits in the issuance transaction before a
bearer credential is returned. The audit records actor, target, purpose and
expiry, excluding the credential itself.

## Rollback planning

Keep enrolment and audit history intact. A code rollback to the previous release
would restore weaker authentication paths, so it needs a deliberate security
review and session revocation. Do not undo this change by disabling TOTP,
resetting operator credentials or deleting audit events.
