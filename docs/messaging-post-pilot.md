# Messaging: post-pilot WhatsApp Cloud integration

**Status:** post-pilot. The friend pilot ships the existing mock provider
(`lib/messaging/provider.ts` resolves to the mock; no Cloud adapter exists in
the tree). The ops catalogue marks `messaging` as `internal`, not `ga`.

## What ships in the pilot

- The mock provider, unchanged, for development and demos.
- `message_log` rows as the operational record of what would have been sent.
- No credentials, no outbound network calls, no template approval process.

## What the real integration requires (post-pilot)

1. **Provider decision and account.** Meta WhatsApp Business Platform (Cloud API)
   with a verified business, a phone number registered to the WABA, and a system
   user token. Alternative BSPs are a commercial decision, not an engineering one.
2. **Credentials and env.** Add `WHATSAPP_CLOUD_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
   `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` to
   `lib/env.ts` (all optional; the app must keep booting without them and fail
   closed when a send is attempted).
3. **Provider implementation.** Implement the `MessageProvider` contract in
   `lib/messaging/cloud-provider.ts`: send, status callback handling, and error
   mapping (rate limits, re-engagement windows, invalid numbers). The contract
   test suite must run against it with credentials present and skip otherwise.
4. **Webhook route.** A signature-verified webhook for delivery/read statuses and
   inbound replies, writing back to `message_log`. New route, same
   session/permission discipline as the rest of the app.
5. **Templates.** Every message that goes out must be a Meta-approved template.
   Map the existing `messageTemplates` catalogue to approved template names and
   languages; keep the local names as the app-side identifiers.
6. **Consent and quiet hours.** Re-check consent purposes at send time; respect
   the tenant timezone's quiet hours; never send to minors without a guardian
   contact on record.
7. **Metering.** Message counts are already logged; wire the plan entitlements
   (`plan_features.limits`) to the provider before enabling sends for a paying
   tenant.
8. **Rollout.** One pilot tenant first, with a manual kill switch in the ops
   console; expand only after a week of clean delivery logs.

## Post-pilot backlog — Reusable WhatsApp API Sandbox

**Backlog only.** No code, env, schema or workflow change ships with this
item. The pilot position is unchanged: the existing mock provider remains
the only provider for the friend pilot; `WHATSAPP_PROVIDER` stays `mock`
outside production and `disabled` in production.

- **Future work:** a reusable sandbox that speaks the WhatsApp Cloud API
  surface — send endpoint, webhook verification, delivery/read status
  callbacks — so `lib/messaging/cloud-provider.ts` can be exercised
  end-to-end without Meta credentials and without sending real messages.
- **Config contract:** the future HTTP adapter must read a configurable
  `WHATSAPP_API_BASE_URL` (default `https://graph.facebook.com`) so the
  same adapter targets either the sandbox or Meta production. It joins
  the planned optional credentials in item 2 above; the app keeps booting
  without them and fails closed when a send is attempted.
- **Tests:** the provider contract suite runs against the sandbox when
  `WHATSAPP_API_BASE_URL` points at it, and skips otherwise — the same
  credential-gated pattern as the live R2 round-trip. No test ever
  targets Meta in CI.
- **Non-goals:** real WhatsApp credentials, inbound production traffic,
  or any change to the pilot mock.

## Explicitly out of scope for the pilot

- Any Cloud adapter code.
- Real WhatsApp credentials or template registration.
- Inbound message handling.
