ALTER TABLE public.users
  ADD COLUMN credential_epoch bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT users_credential_epoch_nonnegative CHECK (credential_epoch >= 0);

ALTER TABLE public.self_service_sessions
  ADD COLUMN credential_epoch bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT self_service_sessions_credential_epoch_nonnegative CHECK (credential_epoch >= 0);

CREATE FUNCTION public.self_service_session_epoch_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.credential_epoch IS DISTINCT FROM OLD.credential_epoch THEN
    RAISE EXCEPTION 'self_service_sessions: credential epoch is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.self_service_session_epoch_immutable() FROM PUBLIC;
CREATE TRIGGER self_service_session_epoch_immutable
  BEFORE UPDATE ON public.self_service_sessions
  FOR EACH ROW EXECUTE FUNCTION public.self_service_session_epoch_immutable();
