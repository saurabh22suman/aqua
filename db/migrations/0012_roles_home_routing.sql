-- F-04's "Never: hard-code behaviour to a role name anywhere in the
-- codebase" was violated in db/platform.ts: resolveHomePath and
-- resolveDefaultMembership branched on roles.key ('owner', 'admin',
-- 'coach', literal strings) to pick a landing route and to break ties
-- when a user holds several memberships. roles.key has no immutability
-- constraint — nothing stops a future UPDATE from renaming it — so that
-- behaviour was one UPDATE away from silently misrouting to /parent with
-- no error. Move the decision onto data the role record owns.
alter table roles
  add column home_path    text    not null default '/parent',
  add column home_ordinal integer not null default 3;
