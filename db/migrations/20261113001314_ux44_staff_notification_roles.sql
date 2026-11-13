-- PROPOSAL ONLY: do not apply without explicit human schema approval.
-- The original inline check is in 20261008062416_whatsapp_notification_eligibility.sql;
-- PostgreSQL named it whatsapp_notification_outbox_recipient_role_check.
-- Existing NULL values are valid (including member and invitation rows).
ALTER TABLE whatsapp_notification_outbox
  DROP CONSTRAINT whatsapp_notification_outbox_recipient_role_check;
ALTER TABLE whatsapp_notification_outbox
  ADD CONSTRAINT whatsapp_notification_outbox_recipient_role_check
  CHECK (recipient_role IS NULL OR recipient_role IN
    ('owner', 'coach', 'receptionist', 'worker', 'manager', 'accountant'));
