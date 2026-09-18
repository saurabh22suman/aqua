-- 20260918123000_m06_pricing_models
--
-- M-06 — pricing model extension (implementation-plan.md M-06). The
-- plan kind sets widen so an academy can offer a fixed term or a
-- drop-in alongside the existing duration / sessions / one_time plans.
--
-- Semantics (mirrored in lib/services/membership-plans.ts and
-- db/preset-definitions.ts):
--   duration     — duration_days; billed as a subscription (C-30)
--   term         — duration_days; same billing shape, labelled a term
--   sessions     — sessions; a class pack
--   one_time     — no payload; sold through an invoice (C-32)
--   per_session  — no payload; pay-as-you-go, sold through an invoice
--   drop_in      — no payload; a single visit, sold through an invoice
--
-- Existing rows are untouched and remain valid: the new checks are
-- strict supersets of the old ones. The constraints are dropped and
-- recreated by name (the payload check on plan_shapes was
-- auto-named plan_shapes_check; it becomes the named
-- plan_shapes_kind_payload_check so future edits have a stable
-- handle).

alter table plan_shapes drop constraint plan_shapes_kind_check;
alter table plan_shapes drop constraint plan_shapes_check;

alter table plan_shapes
  add constraint plan_shapes_kind_check
  check (kind in ('duration', 'sessions', 'term', 'per_session', 'drop_in'));

alter table plan_shapes
  add constraint plan_shapes_kind_payload_check
  check (
    (kind in ('duration', 'term')
      and duration_days is not null
      and sessions is null)
    or
    (kind = 'sessions'
      and sessions is not null
      and duration_days is null)
    or
    (kind in ('per_session', 'drop_in')
      and duration_days is null
      and sessions is null)
  );

alter table membership_plans drop constraint membership_plans_kind_check;
alter table membership_plans drop constraint membership_plans_kind_payload_check;

alter table membership_plans
  add constraint membership_plans_kind_check
  check (kind in ('duration', 'sessions', 'one_time', 'term', 'per_session', 'drop_in'));

alter table membership_plans
  add constraint membership_plans_kind_payload_check
  check (
    (kind in ('duration', 'term')
      and duration_days is not null
      and duration_days > 0
      and sessions is null)
    or
    (kind = 'sessions'
      and sessions is not null
      and sessions > 0
      and duration_days is null)
    or
    (kind in ('one_time', 'per_session', 'drop_in')
      and duration_days is null
      and sessions is null)
  );
