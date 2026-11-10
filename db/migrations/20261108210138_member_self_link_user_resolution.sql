-- member_self_link_user_resolution
-- POSTIMAGE — db/migrations/20261108210138_member_self_link_user_resolution.sql  (candidate, NOT applied)
--
-- THE ACCOUNT'S OWN READ OF ITS OWN ROWS. The session packet's N-4 and the
-- human's G1, applied to FIVE tables in ONE file so that a refusal of it is
-- coherent: either a link-only principal may read its own rows, or it may
-- not, and the answer does not depend on which table is asked first.
--
-- PROPOSED FILENAME. The coordinator mints and validates the final name;
-- it must sort after 20261109100200.
--
-- WHY IT IS NEEDED AT ALL
--   The self PIN door must name the club a link-only principal is signing
--   in to, and it must load the session row that its own cookie points
--   at. The linkage tables are tenant-scoped, and `tenants` under
--   withUser admits a tenant IFF the user holds a membership in it
--   (db/migrations/0011_user_scoped_resolution.sql:34-39). A pure member
--   principal has NO tenant_memberships row at all, so without a policy
--   that admits the account's own rows under withUser, there is no
--   sanctioned way to read them - for any principal, staff or not.
--
-- FOR SELECT ONLY - LOAD-BEARING, NOT A STYLE CHOICE
--   This is exactly the shape tenant_memberships already carries
--   (db/migrations/0011_user_scoped_resolution.sql:26-28), and exactly
--   the shape its own comment demands:
--
--     "FOR SELECT ONLY - load-bearing, not a style choice. A `for all`
--      policy here would default to also governing INSERT/UPDATE, and its
--      WITH CHECK would only be able to constrain user_id (there is no
--      tenant to check against yet). That would let an authenticated user
--      INSERT a tenant_memberships row for themselves against ANY
--      tenant_id - a self-granted membership into a tenant they were
--      never invited to."
--
--   On the LINKAGE tables that escalation is worse: a `for all` policy
--   would let a principal WRITE their own link row into any club. This
--   file therefore declares `for select` and NO with check.
--
--   The same rule applies to the two session tables: a `for all` policy
--   on self_service_sessions would let a principal INSERT a session row
--   for itself against ANY tenant_id - a self-granted entitlement in a
--   club it was never linked to - and a `for update` policy would let it
--   clear its own revoked_at.
--
--   The BINDING LEDGER IS IN THE SET (SX-7). Its sibling session table is
--   readable by the account under withUser(); the ledger - which carries
--   the same user_id and the same audience - was not, so a door that must
--   verify "is this session's binding set still live?" could not do it in
--   the scope in which it can read the session row. The set is coherent
--   now: either a link-only principal may read its own rows, or it may
--   not.
--
-- THE EXISTING tenant_isolation POLICY STAYS
--   Permissive policies OR together in Postgres, so under withTenant()
--   both apply: the tenant scope still sees only its own rows, and the
--   user scope sees the account's own rows. The posture of the tables is
--   WIDENED DELIBERATELY, and only for the account's own rows.
--
-- NO POLICY ON tenants
--   The door's club selector is the club's TENANT ID, not its slug, so
--   the door never needs a slug -> tenant lookup outside a tenant scope.
--
-- WHAT THE SESSION TABLE'S USER-SCOPED READ DOES AND DOES NOT OPEN
--   It lets an account read its OWN session rows: the token HASH (never
--   the token), the bound link ids, the expiry and the revocation state.
--   It does not let an account read another account's rows, and it does
--   not let any account write a session row - the write path is the
--   tenant scope, which is where the rotation index, the revocation path
--   and the audit row all live.
--
-- THE COOPERATIVE-GUC ADVISORY - STATED, NOT SOLVED
--   These policies scope READS. They do not protect the binding's
--   integrity against an app_user SQL primitive, and the app.user_id GUC
--   is COOPERATIVE: an app_user statement can set it to another account's
--   id. That residual is the SAME CLASS as the one the repository already
--   accepts for tenant_memberships, and it is named, not solved. The
--   exposure is the child's linkage, the club's recorded guardian number
--   and the account's own session metadata - not merely a confirmation
--   state, and not a credential: the stored secret is a SHA-256 hash.
--
-- THIS IS A SECURITY-CONFIGURATION CHANGE ON THE TABLES THAT HOLD A
-- CHILD'S LINKAGE AND ON THE CREDENTIAL'S STORAGE. It is the human's to
-- approve, refuse or reshape. Nothing above the schema may be applied
-- before it is answered.

create policy user_resolution on member_account_links
  for select
  using (user_id = nullif(current_setting('app.user_id', true), '')::uuid);

create policy user_resolution on guardian_child_links
  for select
  using (user_id = nullif(current_setting('app.user_id', true), '')::uuid);

create policy user_resolution on self_service_sessions
  for select
  using (user_id = nullif(current_setting('app.user_id', true), '')::uuid);

create policy user_resolution on self_service_session_links
  for select
  using (user_id = nullif(current_setting('app.user_id', true), '')::uuid);

create policy user_resolution on self_service_link_uses
  for select
  using (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
