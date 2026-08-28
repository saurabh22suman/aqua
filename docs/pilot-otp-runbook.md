# Pilot OTP runbook — manual relay (D2a option e)

**This is a pilot-week measure only.** WhatsApp/SMS delivery (C-40) does
not exist yet (`lib/auth/otp-delivery.ts`'s `sink` is a no-op outside
tests — see D2 audit), so for the 2-4 real coaches in the pilot, a human
plays the role of the delivery channel instead of building and then
discarding a throwaway SMS integration under India's TRAI DLT
registration lead time. Nothing else about auth changes: the code is
real, single-use, and expires in 5 minutes — only how it reaches the
coach differs.

## Who runs this

Whoever has direct database access to the production Postgres instance
(the admin doing the pilot rollout — not a coach, not delegated). This
is a manual step performed on request, not a standing service.

## Procedure

1. Coach opens `/login`, enters their phone number, taps **Send code**.
   This writes a row to `ba_verification` exactly as it does today.
2. Admin runs, against the **production** database:

   ```sql
   select identifier,
          split_part(value, ':', 1) as code,
          created_at,
          expires_at,
          expires_at - now() as time_left
   from ba_verification
   where identifier = '+91XXXXXXXXXX'   -- the coach's number, E.164
   order by created_at desc
   limit 1;
   ```

   `value` is stored as `<code>:<attempt count>` (confirmed against a
   live row: `119124:0`) — `split_part` pulls just the code. Confirm
   `time_left` is positive before relaying; if it's expired or already
   consumed, tell the coach to tap **Send code** again and re-run the
   query.
3. Admin relays the code to the coach **by voice call or a direct
   message the admin sends personally** (phone call, or typed directly
   into a chat the admin controls) — within the 5-minute window from
   `created_at`.
4. Coach enters the code in the app themselves, same as the real flow.

## Rules — no exceptions

- **Never paste the code into any shared or logged channel.** No group
  chats, no ticketing systems, no Slack/Discord, nothing that persists
  or has more than the one recipient.
- **Never screenshot the query result or the code.**
- **Never retain it.** Once relayed, the admin's terminal scrollback and
  clipboard should not still hold it any longer than necessary — close
  the psql session or clear scrollback after each use, don't leave a
  terminal with a live code sitting open.
- **One query per login attempt.** Don't pre-fetch or cache codes for
  later use — a code is only useful within its 5-minute window anyway.
- This procedure runs against **production** data belonging to real
  people. Treat the database connection with the same care as any other
  production access — not a dev habit carried over by accident.

## Go-live checklist addition

- [ ] **This runbook is pilot-week only.** It must not survive past the
      pilot: the moment C-40 (real WhatsApp/SMS delivery) lands, this
      procedure is deleted, not kept as a fallback. It must never be
      used for a second tenant — it does not scale past a handful of
      people an admin personally knows, and every use is a manual,
      unaudited read of another person's live authentication credential.
