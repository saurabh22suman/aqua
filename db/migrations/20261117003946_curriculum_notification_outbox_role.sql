-- PROPOSAL ONLY. New forward migration, after verifying current constraint.
ALTER TABLE whatsapp_notification_outbox
  DROP CONSTRAINT whatsapp_notification_outbox_recipient_role_check;
ALTER TABLE whatsapp_notification_outbox
  ADD CONSTRAINT whatsapp_notification_outbox_recipient_role_check
  CHECK (recipient_role IS NULL OR recipient_role IN
    ('owner', 'coach', 'curriculum_lead', 'receptionist', 'worker', 'manager', 'accountant'));
