-- Keep the already-applied failure-visibility migration immutable.
-- Person-scoped tenant queries keep the tenant-leading index convention.
DROP INDEX public.message_log_person_idx;
CREATE INDEX message_log_tenant_person_idx
  ON message_log (tenant_id, person_id) WHERE person_id IS NOT NULL;
