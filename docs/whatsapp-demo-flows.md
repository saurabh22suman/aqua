# WhatsApp demo flows

For October defect fixes, offline/logout changes and hosted synthetic preview
configuration, see [`review-fixes-status.md`](review-fixes-status.md).

## Current local access

- App: `http://localhost:3100/login`.
- Ops: `http://ops.localhost:3100/ops/login`.
- Capture viewer: `http://localhost:3000`.
- Demo operator phone: **+91 90000 00099**. Request the code in ops and read
  the newest message to `919000000099` in the viewer. Password/TOTP are no
  longer web login methods.
- Owner, coach and reception keep phone + PIN login. Their seeded demo PIN is
  **123456**. Browser recovery testing restored the coach to this baseline.

The viewer is the local capture service in
`/home/soloengine/Github/whatsapp-mock`. No real WhatsApp messages are sent.

The sign-in and recovery forms enable after JavaScript loads, keep edits locked
during a request, and focus the next input after verification. Failed requests
can be retried; requesting a replacement preserves the entered phone number.

Stop the local web server before running builds, bundle/font checks or tests
that start their own Next.js server. They share `.next`; concurrent processes
can leave missing browser chunks. Restart the web server afterwards with the
same exported environment overrides (including the database port and mock URL).

## Ops OTP login

1. Enter the registered operator phone on the ops login page.
2. Open the viewer and copy the newest six-digit sign-in code.
3. Enter it and select **Verify code**. The server creates a platform session.

Codes expire after five minutes. Resend has a one-minute cooldown and a
five-request/hour limit per purpose/phone. Verification allows five attempts.
Challenges are browser-bound, hashed, purpose-bound and single-use. Suspended
accounts and changed registered phones cannot complete sign-in. Transport
failure cannot create an authenticated session; the response does not disclose
whether a number exists.

To register a real operator phone through an explicit provisioning operation:

```sh
pnpm exec tsx scripts/set-platform-phone.ts operator@example.com +919876543210
```

This updates an existing active operator and revokes its current sessions. It
does not create a user from a login request. The existing demo operator seeder
accepts `--phone` and defaults to the synthetic number above; its demo/production
safeguards remain in place.

## Forgot PIN

1. Select **Forgot PIN? Reset with WhatsApp** on the normal login page.
2. Enter the registered phone for that individual login.
3. Read the reset code in the viewer, enter it and select **Verify code**.
4. Enter **New PIN** and **Re-enter new PIN**, then select **Save PIN**.
5. Sign in with the new PIN. Existing sessions for this identity are revoked.

The old PIN cannot authorize saving a replacement. A verified reset grant lasts
five minutes and can be consumed only once. PINs remain 6–12 digits. Invited
users still use their first-login invitation, rather than activating themselves
through recovery. Recovery requires an existing identity with an active tenant
membership in an active/trial tenant.

## Notification destinations

Open a member's overview from owner or reception with `members.write` permission.
The **WhatsApp notifications** section lists the student's recorded phone and
phones of linked guardians. Select multiple contacts and **Save destinations**.
Only linked, live contacts with valid numbers can be selected. Unchecking all
stops student-related WhatsApp notifications. Identical phone numbers are
deduplicated for each event.

Without an explicit preference, minors use their primary linked guardian;
adults use their recorded primary number. Choosing destinations does not grant
consent. The registration form now has a separate, unchecked optional
communications-consent choice, witnessed through the existing consent path.
Existing seeded members without communications consent remain paused for
optional student updates. Financial notices survive communications withdrawal,
but minors' fee/payment notices go only to selected guardian numbers.

## Connected event paths

| Event | Recipients |
|---|---|
| Announcements | Selected student/guardian contacts with communications consent; relevant active staff for all/batch audiences |
| Session cancellation/rescheduling | Selected consented contacts, assigned coach, relevant reception/owner location scope |
| Absence alerts | Selected consented contacts, assigned coach and relevant reception/owner scope |
| Waitlist promotion | Selected consented contacts and relevant staff; wording does not promise enrolment |
| Invoice issuance / recorded payments | Selected financial recipients; guardian-only for minors |
| Staff invitations, resend and generated login links | The target membership's registered phone |

Events enqueue durable outbox rows and audits in the originating transaction.
The worker receives a per-tenant job every minute, checks current tenant/account
status, selected contacts and communications consent again, then attempts local
capture. Failed notifications retry on subsequent jobs, up to five attempts.
Pending/sent/failed/suppressed rows are distinct; queueing is not delivery.

Normal concurrent workers are serialized and event/phone keys prevent duplicate
enqueueing. Transport is at-least-once across the external-send/DB-commit crash
window; this capture service provides no provider idempotency or delivery
callbacks. Authentication codes are not stored in tenant message logs.

## Boundaries

The real Cloud adapter, template approval and delivery callbacks remain
post-pilot work. Production still refuses the mock and fails closed without a
real provider; the new ops OTP flow therefore is currently demonstrable locally,
not evidence of a configured production messaging channel. The separate
protected legacy password/TOTP tests require human updates for the approved
authentication change. Existing audit/pilot blockers remain tracked in the
October 5 audit and the demo handoff.
