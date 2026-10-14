-- 20261013181217_membership_links_valid_from
--
-- 2026-10-13 role-workflow audit R09 — a revoked membership's old
-- invite/relogin links must not become live again when the membership
-- is deliberately reactivated. Membership status alone cannot express
-- this: after reactivation an unconsumed, unexpired token minted
-- before the revocation would satisfy every status check.
--
-- `links_valid_from` is the credential epoch. Reactivation sets it to
-- now(); preview and redeem reject any token whose iat predates it
-- (with a small clock-skew grace for the freshly issued link). NULL
-- means "no epoch" — pre-existing memberships are unchanged.

alter table tenant_memberships add column links_valid_from timestamptz;
