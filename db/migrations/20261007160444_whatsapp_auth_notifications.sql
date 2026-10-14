-- whatsapp_auth_notifications
ALTER TABLE platform_users ADD COLUMN phone text UNIQUE
  CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{7,14}$');

CREATE TABLE whatsapp_auth_challenges (
  token_hash text PRIMARY KEY,
  purpose text NOT NULL CHECK (purpose IN ('ops_login', 'pin_reset')),
  phone text NOT NULL,
  principal_id uuid,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  delivered boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX whatsapp_auth_phone_idx ON whatsapp_auth_challenges (phone, purpose, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp_auth_challenges TO app_user;

-- NULL means the existing primary contact; an explicit empty array disables
-- student-related WhatsApp notifications. Services validate linked persons.
ALTER TABLE members ADD COLUMN notification_person_ids uuid[];

CREATE TABLE whatsapp_notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  event_key text NOT NULL,
  member_id uuid,
  recipient_person_id uuid,
  recipient_user_id uuid REFERENCES users(id),
  phone text NOT NULL,
  body text NOT NULL,
  essential boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','suppressed')),
  attempts integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (tenant_id, event_key, phone),
  FOREIGN KEY (member_id, tenant_id) REFERENCES members(id, tenant_id),
  FOREIGN KEY (recipient_person_id, tenant_id) REFERENCES persons(id, tenant_id),
  CHECK ((member_id IS NOT NULL AND recipient_person_id IS NOT NULL AND recipient_user_id IS NULL)
    OR (member_id IS NULL AND recipient_person_id IS NULL AND recipient_user_id IS NOT NULL))
);
CREATE INDEX whatsapp_outbox_pending_idx ON whatsapp_notification_outbox (tenant_id, status, created_at);
ALTER TABLE whatsapp_notification_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_notification_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON whatsapp_notification_outbox
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp_notification_outbox TO app_user;
