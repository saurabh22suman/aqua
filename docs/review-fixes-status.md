# October review remediation

## Approved scope and decisions

- Fix confirmed defects and verification gaps. Unbuilt payroll, bookings,
  uploads, privacy/offboarding product workflows and later modules remain
  separately scoped implementation tasks.
- Attendance requires an enrolment effective on the session date, a live
  active/trial member, an authorized session and a non-cancelled session.
  Trial/makeup cases need explicit eligibility records.
- Logout tries syncing first. Remaining durable local marks require an explicit
  discard decision. Account switching uses the same draft decision before login;
  forced session termination/expiry removes readable cached data.
- A narrowly scoped forward migration may preserve notification eligibility.
- Hosted WhatsApp capture is for a separate **synthetic preview only** before
  launch. Its address/access method is not decided; configuration support is
  prepared, but no hosted connection or real delivery is claimed.
- Dependency changes are not approved for this pass. Retain and document the
  current advisories; no lockfile update or suppression.

## Code changes and targeted evidence

| Finding | Implementation | Evidence |
|---|---|---|
| Resource scope | Actions retain full context; member/batch visibility guards enforce site and coach assignment on history, enrolment, status and transfer; reversal reads check payment site. | `tests/review-action-scopes.test.ts`, `tests/review-resource-integrity.test.ts`, existing location tests. |
| Attendance eligibility | Check effective enrolment, active/trial/live records, session status and coach assignment in the locked mutation transaction. | Negative roster tests and legitimate/replay/rollback cases. |
| Parent-link issue | Owner/admin issuer restriction plus live member/site lookup before signing inside the audit transaction. | Direct-action role and missing/forbidden-target tests. |
| First deploy | Role grant/revoke bootstrap is transactional; deploy reconciles restricted table/partition grants after migrations; CI uses one fresh deploy. | `tests/db/first-deploy-grants.test.ts` passes after exactly one actual deployment. |
| PIN race | Lock the user row while incrementing and calculating lockout; reset the counter after an expired lock. | Five concurrent attempts produce five failures and a lock; expired-lock test. |
| Transfer/date integrity | Lock batches in stable order, validate all resources/refusals before writes and derive business today in the tenant zone. | Exact source rows unchanged after `target_full`. |
| Core audits | Member create/update, enrolment, attendance, status and transfer audit atomically; marks populate actor fields. | Attribution, replay and induced audit-failure rollback tests. |
| Money | Bigint aggregation and guarded exact number boundaries; large accepted sums are refused before allocation; exact INR formatting preserves fractional paise. | Money/kernel/boundary tests, including maximum-safe-integer round trip. |
| WhatsApp audience/scope | Store guardian-only audience and resource/recipient-role scope; recheck sites and coach assignment at dispatch. | Parents-only adult exclusion and revoked-site suppression integration tests. |
| Print | Restrict isolation CSS to actual printable artifacts and retain the premises QR, hiding its print button. | Browser print verification is part of final checks. |
| Retention | Use the same live active-member cohort for the numerator and denominator. | Inactive-member attendance no longer cancels an active member's risk count. |
| UI recovery | Search rejects stale responses and offers retry; status controls handle lost responses, label their reason and release busy; money fields use explicit focus outlines. | Component transport/race tests. |
| Offline confidentiality | Session/tenant/membership namespace, scoped queue/roster writes, lease expiry, storage/logout tombstones, conditional registration, serialized cache mutation and cookie-switch invalidation. | 19 focused offline/logout/action tests; `pnpm e2e:offline-privacy` passes real Chromium reload, draft decision, logout, expiry and account-switch cases. |

Registration and attendance writes are extracted into focused modules;
enrolment remains a bounded, directly reviewable façade method and public
register import paths stay stable. The offline
hook is also reduced to a focused state machine. The broader oversized-module
inventory is maintenance work, not evidence that its product workflows are absent.

## Hosted synthetic capture configuration

Configure when the separate capture app is ready:

```dotenv
AQUA_DEPLOYMENT_STAGE=preview
WHATSAPP_PROVIDER=capture
WHATSAPP_CAPTURE_URL=https://your-capture-origin.example
# Optional protected API/reverse-proxy header. Store its value as a secret.
WHATSAPP_CAPTURE_AUTH_HEADER=authorization
WHATSAPP_CAPTURE_AUTH_VALUE=Bearer your-configured-secret
```

The URL is a bare HTTPS origin, with no embedded credentials/path/query/fragment.
`x-api-key` is also supported as the header name. Redirects are refused. The
capture service must speak the existing `/v23.0/<sender>/messages` mock contract.
The Dev/Dokploy web and worker can receive the same preview variables. The
separate real Production configuration remains disabled until real WhatsApp is
implemented/provisioned. Local `WHATSAPP_MOCK_URL` remains loopback-only; the
production mock and DEMO_MODE guards remain in place. Preview uses a visibly
labelled, independent synthetic database, not real academy records.

## Offline boundaries

- Only explicitly enabled coaches receive private offline HTML; login, parent,
  owner and reception HTML and authenticated images are not cached.
- Queue writes and roster persistence verify the active namespace in their
  transaction. Late writes cannot resurrect a logged-out namespace.
- The server also checks the expected offline namespace before a queued mark
  can mutate attendance. A frontend namespace is not a permission substitute.
- API outages preserve only an already-authorized, unexpired cache. An offline
  device cannot learn a remote revocation until it reconnects or its lease ends.
- Public script/font assets are separate from private scoped documents. Full
  cached HTML is warmed with its dependencies; mutation/clear operations are
  serialized so an in-flight old document cannot recreate a purged cache.
- Legacy unscoped IndexedDB records are removed on the v2 upgrade. Cache and
  queue cleanup precede the normal logout action. Pending drafts are never
  silently discarded by the normal logout/account-switch controls.

## Migration and compatibility

`20261008062416_whatsapp_notification_eligibility.sql` adds only dispatch
eligibility fields and tenant-qualified resource references/indexes. Legacy
queued staff notices lacking a scope are suppressed with migration-coincident
audit rows; membership-bound invitation notices are retained. Existing parent
audience rows gain the guardian-only restriction. Applied older SQL is unchanged.

The dormant password/TOTP database helpers remain tooling/fixture utilities, not
web login doors. Human-owned Tier1 auth expectations must reflect the approved
OTP design; they must not be made green by restoring an unintended public door.

## Remaining external gates

Real hosted capture connectivity/access verification, real WhatsApp provisioning,
Dev/Production VPS verification, live R2 round-trip/restore, counsel decisions,
the business reference month and human release approval remain unverified.
Passing local defect tests does not complete those gates. Full-suite and final
artifact results are recorded after execution; do not infer a green gate from
the targeted table above.

## Verification record

- Frozen install, typecheck, lint, diff whitespace check and applicable
  migration, tenant/location, ops, Compose, workflow, script and focus scanners:
  PASS.
- Exactly one fresh deployment: 105/105 migrations, pg-boss and exact grants
  prepared successfully. The first-deploy grant regression passes.
- Complete sharded run: **332/332 files; 2,565 passed, 7 failed, 8 skipped;
  two failing files**. Evidence: `/tmp/opencode/aqua-review-fixes-final-suite.log`
  and `/tmp/aqua-test-shards-JMGo1K/`.
- Remaining failing files are human-owned: `tests/tier1/platform-auth-actions.test.ts`
  has seven superseded password/TOTP expectations; `tests/tier1/attendance-history.test.ts`
  setup marks members without an effective enrolment and fails the approved
  eligibility guard (six cases are skipped after setup failure). Compatibility
  issues found in the first run were corrected without editing Tier1.
  `git diff -- tests/tier1` is empty.
- Latest affected-path verification: **18 files, 79 tests passed**, covering
  action/resource/rollback, money, grant, messaging, offline, logout and login
  regressions. This does not substitute for a green complete-suite gate.
- Production build succeeds; 97 routes remain below the 150 KB budget, latest
  highest reported First Load JS is 132 KB. Fonts remain **55.2/60 KB**, three
  Latin files. Parent production valid/invalid links each contain zero scripts.
- Chromium bulk offline gate: six scenarios plus cold start PASS (16-mark
  reload/reconnect, replay, last-value, interrupted sync and two devices).
  Disabled gate: all three scenarios PASS. The privacy gate passes scoped
  reload, pending-draft choice, logout, expiry and account switching.
- Host boundary: **25 probes PASS**, including recovery, offline identity and
  ops OTP endpoints. Credential-leak gate: **seven active forms PASS**, with
  actual phone/native POST, code response and gated invite checks.
- Production role-bypass: **25 cases PASS (16 attacks + 9 controls)**. The driver
  uses PIN login; coach action attacks parse valid filters/real IDs and have
  matching entitled action controls. The malformed receptionist case is
  labelled as validation coverage, not permission proof.
- Main synthetic demo received only the approved forward migration, now 105/105.
  Web/worker were restarted with the original local configuration and no
  privileged migration URL on startup. Health reports a healthy worker.
- Browser owner checks at 390×844 and 1280×900 show no page overflow;
  coach/reception sign-out at 390×844 and ops OTP at 1280×900 work.
  Print media retains the staff QR and hides sidebar/switcher/print button.
  Evidence: `.playwright-mcp/review-fixed-staff-qr-print.png` and owner screenshot.

## Human-owned gate follow-up

1. Update Tier1 ops auth expectations to the approved OTP route/disabled legacy
   exports, retaining negative session/cookie/origin/replay cases. Use the new
   auth integration tests as references; do not reopen an unintended login door.
2. Give the Tier1 attendance-history fixture effective enrolments on its seeded
   session dates. Retain the history assertions and add an ineligible-pair denial.
   Do not bypass roster validation for test/system callers.
3. Re-run complete CI on the reviewed PR. Local fixes do not grant merge or
   release approval.

## Retained dependency disposition

The latest `pnpm audit --prod` reports **20 advisories: 7 high, 10 moderate,
3 low**, up from the review-time 18 with the same lockfile. Log:
`/tmp/opencode/aqua-review-fixes-advisories.log`. No advisory is suppressed.

| Chain | Reachability and follow-up |
|---|---|
| Next → PostCSS | CSS/source-map advisories need attacker-controlled CSS/maps. No such upload/request path was found; repository builds process trusted CSS. Keep the findings monitored. |
| source-map-js in build chains | Indexed-map resource exhaustion needs untrusted map ingestion. Not established on a served route; tooling disposition remains open. |
| Next → sharp | Image optimizer is reachable; assess the reported librsvg issue against accepted formats/deployment inputs. No exploitability or clean-audit claim. |
| Better Auth optional tooling → esbuild/Vitest/jsdom/undici | Reported dev-server, WebSocket/cache/pool/interceptor paths are not proven in deployed auth/request handlers. Inventory optional peers/runtime packaging before calling them harmless. |
| Next 15.5.24 SSG/ISR cache poisoning | Two new moderate advisories report a patched threshold of 15.5.27. Generic login/recovery are static; tenant/ops reads are dynamic. No deployed applicability probe was run. The disposition-only decision retains 15.5.24; revisit before launch. |

Hosted capture configuration, protected-test updates and actual deployment/restore
approval remain open. Source changes are uncommitted on the fix branch; no PR,
push, approval label or merge was performed.
