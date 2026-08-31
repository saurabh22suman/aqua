-- C-06: search and filters need something to search on besides a
-- name substring, and createMember's guardian input already accepted
-- a phone field (lib/schemas.ts guardianInputSchema) that register.ts
-- silently dropped -- there was nowhere to put it. architecture.md
-- §8.3 always specified phone on persons; this closes that gap.
alter table persons add column phone text;

create index on persons (tenant_id, phone) where deleted_at is null;
