# db/ — data access rules

- `db/tenant.ts` → `withTenant()` is the ONLY sanctioned way to reach
  tenant-scoped tables. It opens a transaction and sets
  `app.tenant_id` transaction-scoped before your callback runs.
- `users` is a global platform table with no RLS. It is NEVER queried
  directly. Reach it only by joining through `tenant_memberships`
  inside `withTenant()`.
- `db/client.ts` is the raw pool/drizzle instance: platform use only.
  ESLint bans the `@/db/client` import everywhere else; inside `db/`
  use relative imports (`./client`).
- Migrations are forward-only plain SQL in `db/migrations`. Never edit
  an applied migration. Never put secrets in one.
- After any `drop schema` (e.g. `pnpm db:reset`) roles/default
  privileges must be re-bootstrapped — `db/reset.ts` chains this; keep
  it that way.
