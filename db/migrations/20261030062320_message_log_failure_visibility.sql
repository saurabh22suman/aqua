-- message_log_failure_visibility
--
-- F08-B (composed into F08+F09 rev 3): the dispatch writes the metered row only when a provider
-- object exists, so a FAILED send leaves no row in the only messaging surface the product has
-- (the Ops console reads message_log). With no provider — the PRODUCTION default, because an unset
-- WHATSAPP_PROVIDER resolves to 'disabled' and getMessageProvider() then returns null — the
-- failure is invisible to every operator.
--
-- Part 1 — the provider value. The CHECK allowed only ('mock','cloud') while the resolver can
-- produce 'mock' | 'capture' | 'cloud' | 'disabled'. 'capture' is the synthetic preview transport
-- and 'disabled' is the production default with no provider configured; both are real, observable
-- states and must be recordable.
--
-- Part 2 — the STATUS value. The composed job records an unknown delivery outcome in this ledger:
-- the message may or may not have been delivered, and the attempt happened. 'unknown' is NOT a
-- failure — it is exactly the state that must never appear in a list whose buttons offer a retry —
-- so it needs its own value. The CHECK is WIDENED, never narrowed, and the failed list reads
-- status='failed', so an unknown row is excluded from it by construction.
--
-- Part 3 — F7. docs/architecture.md requires consent_class ("records whether the message was
-- essential or suppressible, making suppression queryable and auditable rather than implicit in
-- template names") and its DDL block lists person_id, so a message can be attributed to a person
-- for export or erasure (V-47). Historic rows stay NULL: they never carried the label and must not
-- be back-filled to one.
--
-- Part 4 — failure_reason. The CLASSIFIED reason of the attempt, a closed set, so the platform
-- projection can return a REASON instead of the provider's own text (which can echo the
-- recipient's phone number). Historic rows stay NULL.
--
-- Part 5 — the PLATFORM PROJECTION for the "failed sends" list, with the SAME guard as the outbox
-- projection: it returns a MASKED phone, NO body and the CLASSIFIED reason — never the raw
-- provider error. It does not depend on the pre-existing blanket platform_admin_select policy on
-- message_log, and this migration does NOT change that policy (narrowing it would be an
-- unapproved grant change).
--
-- Forward-only. No existing row is rewritten.
ALTER TABLE message_log DROP CONSTRAINT message_log_provider_check;
ALTER TABLE message_log
  ADD CONSTRAINT message_log_provider_check
  CHECK (provider IN ('mock','capture','cloud','disabled'));
ALTER TABLE message_log DROP CONSTRAINT message_log_status_check;
ALTER TABLE message_log
  ADD CONSTRAINT message_log_status_check
  CHECK (status IN ('queued','sent','delivered','read','failed','received','unknown'));
ALTER TABLE message_log ADD COLUMN consent_class text;
ALTER TABLE message_log ADD COLUMN person_id uuid REFERENCES persons(id) ON DELETE SET NULL;
ALTER TABLE message_log
  ADD CONSTRAINT message_log_consent_class_check
  CHECK (consent_class IS NULL OR consent_class IN ('essential','suppressible'));
ALTER TABLE message_log ADD COLUMN failure_reason text;
ALTER TABLE message_log
  ADD CONSTRAINT message_log_failure_reason_check
  CHECK (failure_reason IS NULL OR failure_reason IN
    ('no_provider','provider_rejected','not_allowed','outcome_unknown'));
CREATE INDEX message_log_person_idx ON message_log (person_id) WHERE person_id IS NOT NULL;
CREATE INDEX message_log_status_idx ON message_log (tenant_id, status, created_at DESC);

-- The ROLE ASSERTION (review P2-1). Same reason as in the outbox migration: OWNERSHIP DOES NOT
-- BYPASS FORCE ROW LEVEL SECURITY. The projection can read the rows only because the role that
-- owns it is a superuser (or has BYPASSRLS); otherwise it would silently return zero rows. This
-- migration FAILS LOUDLY instead.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION
      'ops_failed_messages requires the migration role (%) to be superuser or BYPASSRLS: a '
      'SECURITY DEFINER projection over a FORCE ROW LEVEL SECURITY table cannot read the rows '
      'otherwise, and would silently return zero rows.', current_user;
  END IF;
END
$$;

-- The failed-attempts projection. NO body, NO raw provider error, NO unmasked phone.
CREATE OR REPLACE FUNCTION ops_failed_messages(p_limit integer DEFAULT 50)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  tenant_name text,
  provider text,
  phone_masked text,
  status text,
  category text,
  consent_class text,
  failure_reason text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.id,
         m.tenant_id,
         t.name,
         m.provider,
         CASE WHEN length(m.to_phone) >= 5
              THEN left(m.to_phone, 3) || '••••' || right(m.to_phone, 4) END,
         m.status,
         m.category,
         m.consent_class,
         m.failure_reason,
         m.created_at
  FROM message_log m
  JOIN tenants t ON t.id = m.tenant_id
  WHERE current_setting('app.platform_admin', true) = 'true'
    AND m.status = 'failed'
  ORDER BY m.created_at DESC
  LIMIT greatest(1, least(p_limit, 200));
$$;
REVOKE ALL ON FUNCTION ops_failed_messages(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops_failed_messages(integer) TO app_user;

-- The EXACT count of failed attempts, with the SAME GUARD.
CREATE OR REPLACE FUNCTION ops_failed_messages_count()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::int
  FROM message_log m
  WHERE current_setting('app.platform_admin', true) = 'true'
    AND m.status = 'failed';
$$;
REVOKE ALL ON FUNCTION ops_failed_messages_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops_failed_messages_count() TO app_user;
