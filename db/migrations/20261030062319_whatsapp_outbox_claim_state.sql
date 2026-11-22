-- whatsapp_outbox_claim_state
--
-- F08+F09 (composed, rev 3): the dispatch calls the provider INSIDE the transaction that records
-- the delivery. If the provider accepted the message and the outcome write then fails, the
-- transaction rolls back, the row returns to 'pending' with attempts = 0, and the next run delivers
-- the SAME message again. The attempt bound never advances, because it rolled back with
-- everything else.
--
-- The status CHECK allowed only pending|sent|failed|suppressed, so there was nowhere to record
-- "claimed, and the outcome is not known" — the state that makes the duplicate visible instead
-- of silent.
--
-- This migration adds the durable claim and the honest outcome states:
--   * 'sending' — claimed by a dispatcher; the outcome is not recorded yet.
--   * 'unknown' — claimed, and the outcome was never recorded (or was lost). The message MAY have
--                  been delivered. It is never resent automatically; a human resolves it.
--   * claimed_at         — when the claim was taken (the reaper's cutoff).
--   * provider_message_id — what the provider said, when it said something.
--   * claim_token        — the per-claim FENCE TOKEN. The attempt counter is NOT unique per claim
--                          (an operator resend resets it), so it cannot fence a finalise.
--   * failure_reason     — the CLASSIFIED reason, a closed set. It is what the platform read shows,
--                          so the raw provider text never leaves the tenant boundary.
--
-- It also adds the PLATFORM PROJECTION for the Ops "needs attention" list.
--
-- Forward-only. No existing row is back-filled: a historical 'pending' row was never claimed, and
-- a historical 'sent'/'failed'/'suppressed' row is already terminal.
--
-- The CHECK constraint is named by PostgreSQL's default rule (<table>_<column>_check) because the
-- original migration declared it inline.
ALTER TABLE whatsapp_notification_outbox
  DROP CONSTRAINT whatsapp_notification_outbox_status_check;
ALTER TABLE whatsapp_notification_outbox
  ADD CONSTRAINT whatsapp_notification_outbox_status_check
  CHECK (status IN ('pending','sending','sent','failed','suppressed','unknown'));
ALTER TABLE whatsapp_notification_outbox ADD COLUMN claimed_at timestamptz;
ALTER TABLE whatsapp_notification_outbox ADD COLUMN provider_message_id text;
ALTER TABLE whatsapp_notification_outbox ADD COLUMN claim_token uuid;
ALTER TABLE whatsapp_notification_outbox ADD COLUMN failure_reason text;
ALTER TABLE whatsapp_notification_outbox
  ADD CONSTRAINT whatsapp_notification_outbox_failure_reason_check
  CHECK (failure_reason IS NULL OR failure_reason IN
    ('no_provider','provider_rejected','not_allowed','outcome_unknown'));
CREATE INDEX whatsapp_outbox_claim_idx ON whatsapp_notification_outbox (tenant_id, status, claimed_at);

-- The ROLE ASSERTION (review P2-1). The projections below are SECURITY DEFINER, so they run as
-- their owner. OWNERSHIP DOES NOT BYPASS FORCE ROW LEVEL SECURITY — the owner is subject to the
-- table's policies. The projection can read the outbox at all ONLY because the role that owns the
-- function is a SUPERUSER (or has BYPASSRLS), and a superuser bypasses RLS entirely.
--
-- On a managed deployment whose migration role is NEITHER, the projection would silently return
-- ZERO ROWS and the Ops panel would be silently empty — the exact failure this proposal exists to
-- avoid. So the migration FAILS LOUDLY instead of creating a projection that cannot work. This is
-- an assertion: not a grant, not a configuration change, not a bypass of the isolation rules.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION
      'ops_notification_attention requires the migration role (%) to be superuser or BYPASSRLS: a '
      'SECURITY DEFINER projection over a FORCE ROW LEVEL SECURITY table cannot read the rows '
      'otherwise, and would silently return zero rows.', current_user;
  END IF;
END
$$;

-- The PLATFORM PROJECTION for the Ops "needs attention" list.
--
-- The outbox has FORCE ROW LEVEL SECURITY and only a tenant_isolation policy, so a plain
-- platform-scoped read of it returns ZERO ROWS. The obvious fix — granting `platform_admin_select`
-- on the outbox — would hand platform-wide SELECT over the message BODY and the PHONE of every
-- notification to every query running under app.platform_admin. This migration does NOT grant it.
-- Instead the projection is a SECURITY DEFINER function that returns ONLY the safe columns:
--
--   phone_masked    left(phone,3) || '••••' || right(phone,4)   → "+91••••3210"
--   failure_reason  the CLASSIFIED reason (never the provider's text)
--   event_kind      split_part(event_key, ':', 1) — the KIND only, so the staff-login-link jti
--                   (a token-derived identifier) never reaches a platform surface
--
-- No body, no raw phone, no raw provider error, no job data.
--
-- THE GUARD (review P1-2). The function checks the EXISTING platform scope GUC inside itself:
-- `current_setting('app.platform_admin', true) = 'true'` — the same variable db/scope.ts's
-- withPlatformAdmin() sets and the same variable the existing platform_admin_select policies key
-- on. Outside that scope the function returns ZERO ROWS. That matters because the runtime role IS
-- app_user (db/client.ts issues `set role app_user` on every connection) and EXECUTE has to be
-- granted to it for the app to call the function at all: without the guard, any tenant-scoped SQL
-- path that could call the function would enumerate the CROSS-TENANT attention list. The masking
-- limits the columns, not the rows.
--
-- search_path is pinned and EXECUTE is revoked from PUBLIC, so the function cannot be shadowed by
-- a hostile object in the search path and can only be called with an explicit argument.
CREATE OR REPLACE FUNCTION ops_notification_attention(p_limit integer DEFAULT 50)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  tenant_name text,
  status text,
  attempts integer,
  event_kind text,
  phone_masked text,
  failure_reason text,
  claimed_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT n.id,
         n.tenant_id,
         t.name,
         n.status,
         n.attempts,
         split_part(n.event_key, ':', 1),
         CASE WHEN length(n.phone) >= 5
              THEN left(n.phone, 3) || '••••' || right(n.phone, 4) END,
         n.failure_reason,
         n.claimed_at,
         n.created_at
  FROM whatsapp_notification_outbox n
  JOIN tenants t ON t.id = n.tenant_id
  WHERE current_setting('app.platform_admin', true) = 'true'
    AND (n.status = 'unknown' OR (n.status = 'failed' AND n.attempts >= 5))
  ORDER BY n.created_at DESC
  LIMIT greatest(1, least(p_limit, 200));
$$;
REVOKE ALL ON FUNCTION ops_notification_attention(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops_notification_attention(integer) TO app_user;

-- The EXACT count, for the Ops overview tile. It cannot be derived from the list function, which
-- is limit-bounded: a count capped at the list limit would be a quiet lie on a busy day. It
-- carries the SAME GUARD: outside the platform scope it returns zero.
CREATE OR REPLACE FUNCTION ops_notification_attention_count()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::int
  FROM whatsapp_notification_outbox n
  WHERE current_setting('app.platform_admin', true) = 'true'
    AND (n.status = 'unknown' OR (n.status = 'failed' AND n.attempts >= 5));
$$;
REVOKE ALL ON FUNCTION ops_notification_attention_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops_notification_attention_count() TO app_user;
