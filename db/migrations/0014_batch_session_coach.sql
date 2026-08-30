-- getTodayAction (lib/actions/coach.ts) showed every session in the
-- tenant to any staff member -- a coach could see, and via
-- getRosterAction mark, another coach's register. Closing it needs to
-- know which coach a session belongs to.
--
-- Bare uuid, no foreign key -- same shape as attendance.marked_by.
-- staff (C-04) doesn't exist yet, so this can't reference it; it's a
-- direct user id for now and should be migrated onto staff.user_id
-- once C-04 lands (see docs/implementation-plan.md C-20's note).
--
-- On batches: the assigned coach. On sessions: the actual coach for
-- that specific session, copied from the batch at generation time
-- (lib/jobs/session-generator.ts) and independently updatable later --
-- this is what C-20 (substitution) will write to without touching the
-- batch's own assignment.
alter table batches  add column coach_id uuid;
alter table sessions add column coach_id uuid;
