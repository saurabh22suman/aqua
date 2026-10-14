-- whatsapp_notification_eligibility
ALTER TABLE whatsapp_notification_outbox
  ADD COLUMN audience text NOT NULL DEFAULT 'selected' CHECK (audience IN ('selected','guardians')),
  ADD COLUMN recipient_role text CHECK (recipient_role IN ('owner','coach','receptionist')),
  ADD COLUMN scope_location_id uuid,
  ADD COLUMN scope_batch_id uuid,
  ADD COLUMN scope_session_id uuid,
  ADD CONSTRAINT whatsapp_outbox_location_fk FOREIGN KEY (scope_location_id,tenant_id)
    REFERENCES locations(id,tenant_id) ON DELETE CASCADE,
  ADD CONSTRAINT whatsapp_outbox_batch_fk FOREIGN KEY (scope_batch_id,tenant_id)
    REFERENCES batches(id,tenant_id) ON DELETE CASCADE,
  ADD CONSTRAINT whatsapp_outbox_session_fk FOREIGN KEY (scope_session_id,tenant_id)
    REFERENCES sessions(id,tenant_id) ON DELETE CASCADE;

CREATE INDEX whatsapp_outbox_scope_location_idx ON whatsapp_notification_outbox (tenant_id,scope_location_id);
CREATE INDEX whatsapp_outbox_scope_batch_idx ON whatsapp_notification_outbox (tenant_id,scope_batch_id);
CREATE INDEX whatsapp_outbox_scope_session_idx ON whatsapp_notification_outbox (tenant_id,scope_session_id);

UPDATE whatsapp_notification_outbox o SET audience='guardians'
WHERE o.member_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM announcements a WHERE a.tenant_id=o.tenant_id
    AND o.event_key='announcement:'||a.id::text AND a.audience='parents'
);

-- Legacy staff notices lack the resource eligibility snapshot. Fail closed;
-- invitation notices already carry a membership-bound key and remain valid.
WITH suppressed AS (
  UPDATE whatsapp_notification_outbox SET status='suppressed',
    error='Legacy notification has no dispatch scope.'
  WHERE recipient_user_id IS NOT NULL AND status IN ('pending','failed')
    AND event_key NOT LIKE 'login_link:%'
  RETURNING id,tenant_id,event_key
)
INSERT INTO audit_log (tenant_id,actor_type,source,action,entity_type,entity_id,after)
SELECT tenant_id,'system','job','whatsapp.notification.suppressed','whatsapp_notification',id,
  jsonb_build_object('eventKey',event_key,'reason','missing_legacy_scope') FROM suppressed;
