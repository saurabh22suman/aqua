-- whatsapp_auth_scope_and_outbox_erasure
ALTER TABLE whatsapp_auth_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_auth_challenges FORCE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_auth_scope ON whatsapp_auth_challenges
  USING (current_setting('app.whatsapp_auth', true) = 'true')
  WITH CHECK (current_setting('app.whatsapp_auth', true) = 'true');

ALTER TABLE whatsapp_notification_outbox ALTER COLUMN id DROP DEFAULT;
ALTER TABLE whatsapp_notification_outbox DROP CONSTRAINT whatsapp_notification_outbox_tenant_id_fkey;
ALTER TABLE whatsapp_notification_outbox ADD CONSTRAINT whatsapp_notification_outbox_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE whatsapp_notification_outbox DROP CONSTRAINT whatsapp_notification_outbox_member_id_tenant_id_fkey;
ALTER TABLE whatsapp_notification_outbox ADD CONSTRAINT whatsapp_notification_outbox_member_id_tenant_id_fkey
  FOREIGN KEY (member_id, tenant_id) REFERENCES members(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE whatsapp_notification_outbox DROP CONSTRAINT whatsapp_notification_outbox_recipient_person_id_tenant_id_fkey;
ALTER TABLE whatsapp_notification_outbox ADD CONSTRAINT whatsapp_notification_outbox_recipient_person_id_tenant_id_fkey
  FOREIGN KEY (recipient_person_id, tenant_id) REFERENCES persons(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE whatsapp_notification_outbox DROP CONSTRAINT whatsapp_notification_outbox_recipient_user_id_fkey;
ALTER TABLE whatsapp_notification_outbox ADD CONSTRAINT whatsapp_notification_outbox_recipient_user_id_fkey
  FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE;
