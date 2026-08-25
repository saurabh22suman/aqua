# db/ — data access rules

- `db/tenant.ts` → `withTenant()` is the ONLY sanctioned way to reach
  tenant-scoped tables. It opens a transaction and sets
  `app.tenant_id` transaction-scoped before your callback runs.
- An unscoped read returns ZERO ROWS, never an error. Symptoms are
  unique-key collisions, missing records and wrong counts — never a
  permissions error. If data you just wrote appears absent, suspect
  scoping before suspecting the write. In dev/test the pool throws a
  P0001 "Unscoped query" error on out-of-scope statements: tenant work
  goes in `withTenant()`, platform surfaces declare `withPlatform()`.
- `users` is a global platform table with no RLS. It is NEVER queried
  directly. Reach it only by joining through `tenant_memberships`
  inside `withTenant()`.
- `db/client.ts` is the raw pool/drizzle instance: platform use only.
  ESLint bans the `@/db/client` import everywhere else; inside `db/`
  use relative imports (`./client`).
- Migrations are forward-only plain SQL in `db/migrations`. Never edit
  an applied migration. Never put secrets in one.
- Invariant: `bootstrap-roles` ALWAYS runs before migrations on any
  fresh database — some migrations grant to `app_user`, and the roles
  must exist by then. `db/reset.ts` maintains this order.
- After any `drop schema` (e.g. `pnpm db:reset`) roles/default
  privileges must be re-bootstrapped — `db/reset.ts` chains this; keep
  it that way.
