# Architecture — Aqua

**Phases 1 to 3: platform foundation, operating core, and swimming vertical through go-live.**

| | |
|---|---|
| Document | Technical architecture |
| Version | 0.1 (draft) |
| Covers | Phases 1–3 |
| Companion | `project-scope.md`, `DESIGN.md` |

---

## 1. Principles

1. **Boring wins.** One deployable, one database, one language. The economics of a ₹500–6,000/month product cannot support operational complexity.
2. **Isolation is enforced by the database, not by discipline.** Every tenant-scoped query must be safe even when the application layer forgets.
3. **The schema is the long-lived asset.** Application code will be rewritten repeatedly. The data model will not. It gets designed by hand and reviewed before any feature work.
4. **Make the safe path the only path.** If there is a way to write an unscoped query, someone eventually will. Remove the ability.
5. **Defer distributed anything.** Queues, caches and replicas are added when a measurement demands them, never in anticipation.
6. **Cost per tenant is a design constraint.** Every architectural choice is checked against low-hundreds-of-rupees per tenant per month.

### 1.1 A note on AI-assisted development

Code will largely be generated. This changes velocity, not consequences, and it shifts where care must go:

- Generated code drifts. Constraints must be **mechanical** — CI checks, lint rules, database policies — not conventions in a document.
- The model will forget `WHERE tenant_id = ?`. Row-level security means that forgetting is harmless.
- The model degrades on large files. Keep modules under roughly 300 lines.
- Types are how you review code you did not write. Strict TypeScript everywhere, Zod at every boundary.

---

## 2. Scale reality check

Sizing before choosing anything:

| Dimension | Year-one projection |
|---|---|
| Tenants | 25–50 |
| Members per tenant | 100–1,000 |
| Total people records | ~50,000 |
| Sessions/year | ~500,000 |
| Attendance rows/year | ~6,000,000 |
| Peak concurrent users | < 200 |
| Peak write rate | < 50/s (morning and evening batch windows) |

**Conclusion:** a single Postgres instance handles this comfortably for several years. There is no scaling problem to solve. The constraints that will actually bite are query quality, index coverage and support load.

Load is sharply bimodal — 6–9 AM and 5–9 PM. Design for burst, not sustained throughput.

---

## 3. Stack

| Layer | Choice | Rationale |
|---|---|---|
| Runtime | Node 22 LTS | |
| Framework | Next.js 15, App Router, TypeScript strict | RSC-first keeps the client bundle small |
| Styling | Tailwind + shadcn/ui (copied, not installed) | No component library runtime dependency |
| Database | PostgreSQL 16, **Mumbai region** | Region matters more than provider; a US-hosted DB makes the app feel broken in India |
| Data access | Drizzle ORM | SQL-first, so Postgres RLS integrates naturally via session variables. Prisma supports RLS but has historically been weaker there — and RLS is the one thing that cannot be got wrong here |
| Auth | Better Auth, self-hosted | **Never per-MAU pricing** — parents and students are users |
| Jobs | pg-boss on the same Postgres | One fewer service; Redis only when measurement demands it |
| Payments | Razorpay | Payment links, then UPI e-mandate in Phase 3 |
| Messaging | WhatsApp Cloud API via a BSP, behind our own interface | Swap to direct Cloud API later without a rewrite |
| Storage | Cloudflare R2 | S3-compatible, no egress fees |
| Hosting | Container platform (Railway / Render / Fly) or Hetzner + Coolify | Long-running workers, cron and predictable cost |
| Errors | Sentry | |
| Analytics | PostHog — **staff surfaces only** | Never on parent or student pages, per DPDP |

### 3.1 Deliberately rejected

| Rejected | Reason |
|---|---|
| Clerk / Auth0 | Per-MAU pricing inverts margins when every parent is a user |
| Prisma | Faster for plain CRUD, and **Prisma 7 removed the Rust engine binary**, so the old size penalty no longer applies. Rejected on one ground only: RLS integration is cleaner and safer in Drizzle |
| Vercel | Fine early, but cost curve and function limits are hostile to background work at this ARPU |
| Redis / BullMQ (Phase 1–3) | pg-boss is sufficient below ~1,000 jobs/minute |
| Microservices | Wrong at every axis for this product |
| Database-per-tenant | Unnecessary at this scale; migration and backup cost multiplies by tenant count |
| GraphQL | Server Actions and typed route handlers cover it |

### 3.2 Known risks in these choices

Validated against current sources (August 2026). The stack holds, but these are live.

| Choice | Risk | Mitigation |
|---|---|---|
| **Drizzle** | Has not reached 1.0. Minor-version churn and package consolidation are ongoing | Pin exact versions. Keep migrations as raw SQL so the schema survives an ORM change |
| **Better Auth** | Young and moving fast. Production teams report the access-control plugin documentation is sparse enough to require reading library source | Budget extra time on F-09, F-10 and F-11. Read source rather than guessing |
| **pg-boss** | Fine at this volume, but the job API has changed across majors | Pin the version, isolate handlers behind our own interface |
| **Single Postgres** | No horizontal escape hatch without work | Correct at projected load. A read replica is the first step and is a config change |

None of these is a reason to change the stack. All are reasons to pin versions and read current documentation rather than relying on model recall — see `agent-setup.md` §4.2.

---

## 4. Deployment topology

```
                         Cloudflare
                    (DNS, TLS, CDN, WAF)
                             │
                   ┌─────────┴─────────┐
                   │                   │
              Web container       Worker container
              (Next.js)           (pg-boss consumer)
                   │                   │
                   └─────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
        PostgreSQL 16     R2 bucket    External APIs
        (Mumbai)          (media,      Razorpay
        + pg-boss         exports)     WhatsApp BSP
        + daily backup                 Sentry
        + PITR
```

Two containers from one image, differing only by start command. The worker holds no HTTP surface. Both scale horizontally, though neither will need to for a long time.

**Environments:** local (Docker Compose), staging (one container each, small DB), production. Staging carries anonymised data only — never a production dump.

---

## 5. Multi-tenancy

### 5.1 Model

Shared database, shared schema, `tenant_id` on every business table, enforced by row-level security.

### 5.2 The isolation stack

Four independent layers. Any one failing is survivable; all four failing is not plausible.

| Layer | Mechanism |
|---|---|
| 1. Routing | Tenant slug resolved from the URL, validated against the session |
| 2. Session | Every request establishes a tenant context before any query |
| 3. Query | All access goes through a scoped accessor that sets the session variable |
| 4. **Database** | RLS policies reject rows outside the current tenant regardless of the query |

### 5.3 RLS implementation

Every tenant-scoped table gets the same treatment:

```sql
alter table members enable row level security;
alter table members force row level security;

create policy tenant_isolation on members
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
```

`force row level security` matters — without it, the table owner bypasses policies entirely.

The `nullif` wrapper is load-bearing: once a pooled connection has served a `set_config` transaction, `current_setting('app.tenant_id', true)` reverts to the empty string rather than NULL, so an unguarded cast turns any accidental unscoped query into a confusing `invalid input syntax for type uuid` error. With `nullif`, no context means zero rows — uniform, fail closed.

The application connects as a role that is **not** the table owner and has no `BYPASSRLS`. Authentication is separated from privilege: `app_login` may connect but, being `NOINHERIT`, holds no grants of its own — only `SET ROLE` empowers it:

```sql
create role app_user nologin;
grant select, insert, update, delete on all tables in schema public to app_user;
alter default privileges in schema public
  grant select, insert, update, delete on tables to app_user;
-- app_user is deliberately NOT the owner and does NOT have BYPASSRLS

create role app_login login noinherit password '<from secret store>';
grant app_user to app_login;   -- membership authorises SET ROLE
```

The pool drops privileges once per **physical** connection. Tenant context stays per-transaction via `set_config` and is unaffected by role:

```ts
// db/client.ts
pool.on("connect", (client) => {
  return client.query("set role app_user");
});
```

Without `NOINHERIT`, `app_login` would silently hold `app_user`'s grants through role inheritance and the `SET ROLE` would be a formality — the isolation test asserts `current_user = 'app_user'` precisely to catch that regression (§5.6). If a transaction-mode pooler is ever introduced, grant `LOGIN` to `app_user` directly and point `DATABASE_URL` at it.

Migrations and the platform control plane use a separate privileged role, never the request path.

### 5.4 The scoped accessor

This is the single most important piece of application code in the system.

```ts
// db/tenant.ts — the ONLY sanctioned way to reach tenant data

export async function withTenant<T>(
  tenantId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}
```

The third argument `true` scopes the setting to the transaction, so it cannot leak across pooled connections.

Usage:

```ts
const dues = await withTenant(ctx.tenantId, (tx) =>
  tx.select().from(invoices).where(eq(invoices.status, 'overdue'))
);
```

Note the query has no `tenant_id` clause. It does not need one — RLS applies it. If the model generates an unscoped query, it returns only the current tenant's rows anyway.

### 5.5 Making it mandatory

```js
// eslint.config.mjs — import/no-restricted-paths, not no-restricted-imports
{
  files: ['**/*.ts', '**/*.tsx'],
  rules: {
    'import/no-restricted-paths': ['error', {
      zones: [{
        target: './{app,components,lib}/**/*',
        from: './db/client.ts',
        message: 'Raw client bypasses tenant scoping — use withTenant()/withUser() or withPlatform(). The only other sanctioned handle is @/db/auth-db.',
      }],
    }],
  },
}
```

This resolves module identity, not import text on purpose: an earlier
version matched the literal string `@/db/client` (`no-restricted-imports`)
and missed a relative import (`../../db/client`) resolving to the same
file — two real call sites reached the raw client that way and the rule
reported clean. `import/no-restricted-paths` catches both spellings
identically because it resolves to a file path before comparing.

Now "did this query get scoped?" is a build failure rather than a code review question.

### 5.6 Isolation test — a CI gate

```ts
test('tenant A cannot read tenant B data under any query shape', async () => {
  const a = await createTenant(); const b = await createTenant();
  await seedMembers(b.id, 10);

  const leaked = await withTenant(a.id, (tx) => tx.select().from(members));
  expect(leaked).toHaveLength(0);

  const raw = await withTenant(a.id, (tx) =>
    tx.execute(sql`select * from members where tenant_id = ${b.id}`)
  );
  expect(raw.rows).toHaveLength(0);

  const who = await withTenant(a.id, (tx) =>
    tx.execute(sql`select current_user`)
  );
  expect(who.rows[0].current_user).toBe('app_user');
});
```

The second and third assertions are the important ones: even an explicitly hostile query returns nothing, and a mis-configured pool that skipped `SET ROLE` fails loudly instead of inheriting privileges silently.

### 5.7 Pre-tenant resolution

`withTenant()` needs a tenant. Better-auth authenticates a *user* first — the request has an identity before it has a tenant. Mapping identity to "which tenant, which membership, which role" (slug validation, the default-membership landing page) genuinely cannot run inside `withTenant()`: the tenant is the output of this step, not its input.

The original build resolved this by connecting as `aqua` — the Postgres superuser behind `MIGRATION_DATABASE_URL` — and trusting hand-written `WHERE` clauses to scope the query correctly. That is a real superuser: `rolsuper=t`, `rolbypassrls=t`. It bypasses RLS unconditionally, `FORCE ROW LEVEL SECURITY` included. An independent review found it live on the authenticated request path (`db/platform.ts`), sitting directly in front of every request's tenant resolution, defended by nothing but the correctness of the SQL. `MIGRATION_DATABASE_URL` is migrations-only now, full stop — no exception, anywhere, for any reason.

The fix is symmetric to `withTenant()`, not a bypass of it:

```ts
// db/tenant.ts
export async function withUser<T>(
  userId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}
```

paired with a second, `for select`-only, permissive RLS policy on the three tables resolution touches:

```sql
create policy user_resolution on tenant_memberships
  for select
  using (user_id = nullif(current_setting('app.user_id', true), '')::uuid);

create policy user_resolution on tenants
  for select
  using (id in (
    select tenant_id from tenant_memberships
    where user_id = nullif(current_setting('app.user_id', true), '')::uuid
  ));

create policy user_resolution on roles
  for select
  using (id in (
    select role_id from tenant_memberships
    where user_id = nullif(current_setting('app.user_id', true), '')::uuid
  ));
```

Postgres OR's permissive policies together. This widens visibility only for a transaction that called `withUser()` and set `app.user_id`; `withTenant()` never sets it, so ordinary tenant-scoped code is unaffected — the OR's second branch is always false there. The connection identity does not change: still `app_user`, still no `BYPASSRLS`, still no superuser. A query with no `WHERE` clause at all, run inside `withUser(userId, ...)`, is confined to that user's own rows by Postgres — not by whoever wrote the SQL getting it right. That is the actual point of RLS, applied to the one place it had been skipped.

Two things are load-bearing and easy to get wrong:

- **`for select`, never `for all`.** A `for all` policy's `WITH CHECK` could only constrain `user_id` — there is no tenant to check against during resolution. That would let a user `INSERT` a `tenant_memberships` row for themselves against any `tenant_id`: a self-granted membership into a tenant they were never invited to. Writes stay exclusively under the pre-existing tenant-scoped policy, reached only through `withTenant()`.
- **`withTenant()` and `withUser()` must not nest.** Both set a session variable RLS branches on; nesting either inside the other would let a single transaction carry both `app.tenant_id` and `app.user_id`, OR-ing their policies into a wider view than either mode intends alone. `db/scope.ts`'s `enterScope()` throws if one is entered while the other is active. `withPlatform()` sets no session variable and nests freely with either — better-auth's own call chain relies on this (an outer `withPlatform()` around `auth.api.verifyPhoneNumber` legitimately triggers an inner `withPlatform()` around `linkBetterAuthUser`, via `callbackOnVerification`).

`resolveLocationIds` is not part of this: by the time it runs, `tenantId` is already known, so it is ordinary `withTenant()` work, not resolution.

Mechanical guarantees, not code review: `tests/tier1/user-scope.test.ts` proves an unscoped read inside `withUser()` stays confined, a write inside `withUser()` is rejected (Postgres `42501`), a read inside `withTenant()` cannot see a row only the user-scoped policy would expose, and dropping the `user_resolution` policy turns both that suite and `auth-context.test.ts`'s slug-resolution test red. `tests/tier1/no-superuser-on-request-path.test.ts` asserts `MIGRATION_DATABASE_URL` appears only in migration/bootstrap/reset/seed tooling and test fixtures.

**A note on defense in depth, not a gap in this fix:** the dev/test ALS scope guard (`db/client.ts`, "Unscoped query" P0001) is disabled when `NODE_ENV=production` — RLS is the layer that's still supposed to hold in production, by design (§5.2, §5.3). That means the `withPlatform()` wraps around every better-auth call site (commented "load-bearing" at each site) are exercised as a hard failure only in dev/test; in a production build, an accidentally-removed wrap would not throw — better-auth's own tables have no RLS to fall back on either (they're platform-exempt, §5.3's allowlist). This has not been exercised under an actual production build. Recorded in `implementation-plan.md` at B6.

---

## 6. Identity and authorisation

### 6.1 Authentication

Phone number plus OTP is the primary method — it matches how this market actually works. Email and password exists as a fallback for desktop staff.

| Actor | Method |
|---|---|
| Staff | Phone OTP, session cookie, 30-day sliding expiry |
| Owner / admin | Same, plus optional email login |
| Parent | **No account.** Signed magic link, single-purpose, 7-day expiry |
| Walk-in customer | No account. Booking reference plus phone |
| Platform staff | Separate table, separate session, mandatory 2FA |

A person can belong to multiple tenants (a coach working at two academies). Identity is global; membership is per tenant.

### 6.2 Authorisation model

```
User → TenantMembership → Role → Permissions
                            ↓
                     Location scope
                            ↓
                    Module entitlement
```

Three independent checks, all of which must pass:

1. **Permission** — does this role hold `attendance.mark`?
2. **Location scope** — is this session at a branch this membership covers?
3. **Feature entitlement** — is the `attendance` module enabled for this tenant?

Permissions are `resource.action` strings: `members.read`, `members.write`, `invoices.write`, `payments.record`, `reports.financial`, `settings.manage`.

Roles are seeded per tenant from templates and are editable. Nothing is hard-coded to a role name.

```ts
export async function requirePermission(ctx: Ctx, permission: string) {
  if (!ctx.permissions.has(permission)) throw new Forbidden(permission);
  const [module] = permission.split('.');
  if (!ctx.features.has(module)) throw new FeatureDisabled(module);
}
```

### 6.3 Request context

Resolved once per request, in middleware, and passed down. Never re-derived.

```ts
type Ctx = {
  userId: string;
  tenantId: string;
  membershipId: string;
  locationIds: string[];
  permissions: Set<string>;
  features: Set<string>;
  impersonatedBy?: string;   // platform support — always audited
};
```

---

## 7. Feature entitlements

### 7.1 Resolution order

```
plan_features (baseline for the tenant's plan)
      ↓  overridden by
tenant_features (per-tenant grants, trials, betas)
      ↓  produces
effective feature set  →  cached in request context
```

### 7.2 Schema

```sql
create table plans (
  id          uuid primary key,
  key         text unique not null,               -- 'standard'
  name        text not null,
  status      text not null default 'active',     -- active | deprecated
  price_paise bigint,                             -- NULL = deliberately unpriced
  currency    text not null default 'INR',
  is_default  boolean not null default false,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

create table features (
  key         text primary key,          -- 'pool.booking', 'cafe.pos'
  name        text not null,
  category    text not null,
  status      text not null default 'ga' -- ga | beta | internal
);

create table plan_features (
  plan_id     uuid references plans(id),
  feature_key text references features(key),
  limits      jsonb not null default '{}',
  primary key (plan_id, feature_key)
);

create table tenant_features (
  tenant_id   uuid references tenants(id),
  feature_key text references features(key),
  enabled     boolean not null,
  config      jsonb not null default '{}',
  expires_at  timestamptz,
  primary key (tenant_id, feature_key)
);
```

`config` holds admin-tunable settings for developer-defined keys:

```json
{
  "attendance": { "qr_checkin": true, "late_threshold_minutes": 10 },
  "booking":    { "max_days_ahead": 30, "cancellation_window_hours": 4 }
}
```

This is the boundary of configurability for v1. Admins tune values the developers defined. There is no rules engine, no form builder, no workflow designer — see the scope document's out-of-scope section.

`plans.price_paise` is deliberately nullable: entitlement resolution reads `plan_features`, never price. The pricing-model decision (scope §2.5) lands as a data change — insert plans, flip `tenants.plan_id`, which defaults to `standard` at provisioning — with zero schema edits.

### 7.3 Enforcement

Both layers, always:

- **API** — `requirePermission` checks the module entitlement. A disabled feature returns 403 even if someone crafts the request.
- **UI** — navigation and controls for disabled features are not rendered.

UI-only gating is not gating.

### 7.4 Onboarding presets

A preset is a versioned bundle of entitlements plus seed data, applied once when a tenant is created. It sits directly on top of the entitlement system — a preset does not introduce a new mechanism, it just writes the same rows a platform admin would write by hand.

```sql
create table presets (
  key         text not null,          -- 'swimming', 'football'
  version     int  not null,
  name        text not null,
  description text not null,
  definition  jsonb not null,
  status      text not null default 'active',  -- active|deprecated
  primary key (key, version)
);
```

Presets are **platform-level** — not tenant-scoped, no RLS, read-only at request time.

The applied preset is recorded on the tenant for analytics only. It carries no runtime behaviour:

```sql
alter table tenants
  add column preset_key     text,
  add column preset_version int,
  add column preset_applied_at timestamptz;
```

**Nothing reads `preset_key` to decide what the application does.** Behaviour is always driven by resolved entitlements. If any code branches on preset, presets have become a fork mechanism and the abstraction has failed.

#### Definition shape

```jsonc
{
  "features": ["members", "attendance", "billing", "pool.booking", "swim.levels"],
  "terminology": { "student": "swimmer", "batch": "batch", "coach": "coach" },
  "roles": [
    { "name": "Head coach", "permissions": ["members.read", "attendance.mark", "assessments.write"] }
  ],
  "programs": [{ "name": "Learn to swim", "activity": "swimming" }],
  "skillLevels": [
    { "name": "Beginner",     "ordinal": 1,
      "skills": [{ "name": "Water confidence", "rubric": { "1": "…", "4": "…" } },
                 { "name": "Freestyle",        "rubric": { "1": "…", "4": "…" } }] },
    { "name": "Intermediate", "ordinal": 2, "skills": [ /* … */ ] }
  ],
  "planShapes": [
    { "name": "Monthly",   "kind": "duration", "durationDays": 30,  "amountPaise": null },
    { "name": "Quarterly", "kind": "duration", "durationDays": 90,  "amountPaise": null }
  ],
  "facilities": [{ "name": "Main pool", "kind": "pool", "capacity": 40,
                   "subUnits": ["Lane 1","Lane 2","Lane 3","Lane 4"] }],
  "exampleBatches": [
    { "name": "Beginners", "daysOfWeek": [1,3,5], "startTime": "07:00", "capacity": 16 }
  ],
  "messageTemplates": ["fee_due", "session_reminder", "receipt", "session_cancelled"],
  "dashboardCards": ["dues", "attention", "todays_lanes"]
}
```

`amountPaise` is deliberately `null`. A seeded price a club forgets to change becomes a billing dispute; the onboarding wizard makes the field required before the plan can be activated.

#### Application

```ts
export async function applyPreset(tenantId: string, key: string) {
  const preset = await platformDb.query.presets.findFirst({
    where: and(eq(presets.key, key), eq(presets.status, 'active')),
    orderBy: desc(presets.version),
  });
  if (!preset) throw new NotFound(`preset:${key}`);

  await withTenant(tenantId, async (tx) => {
    const d = preset.definition;
    await enableFeatures(tx, tenantId, d.features);
    await setTerminology(tx, tenantId, d.terminology);
    await seedRoles(tx, d.roles);
    await seedPrograms(tx, d.programs);
    await seedSkillLadder(tx, d.skillLevels);
    await seedPlanShapes(tx, d.planShapes);
    await seedFacilities(tx, d.facilities);
    await seedExampleBatches(tx, d.exampleBatches, { isSample: true });
    await registerTemplates(tx, d.messageTemplates);
    await setDashboardCards(tx, d.dashboardCards);

    await tx.update(tenants).set({
      presetKey: key, presetVersion: preset.version, presetAppliedAt: new Date(),
    }).where(eq(tenants.id, tenantId));
  });
}
```

One transaction. A partial application leaves a tenant in a state nobody can reason about, so it either fully lands or fully rolls back.

#### Rules the implementation must hold

1. **Idempotent per tenant.** Re-running is either a no-op or a full discard-and-reseed. Never additive — that produces four "Beginners" batches.
2. **Applied once, then inert.** Editing a preset definition publishes a **new version**. Existing tenants are untouched. There is no migration path from preset v1 to v2, by design.
3. **Nothing a preset creates is privileged.** Every seeded row is an ordinary row the tenant can edit or delete through the normal UI.
4. **Sample rows are flagged.** `is_sample boolean` on seeded batches and programs, powering a one-tap "remove sample data" action that disappears once anything real is attached.
5. **Lock after first real use.** Once a non-sample member exists, `applyPreset` refuses. Reconfiguration from that point is manual.
6. **No runtime branching.** Enforced by a lint rule restricting reads of `preset_key` to the analytics module.

#### Phase note

The preset definitions should be written in **Phase 1** and used as the internal provisioning mechanism from the first tenant onward — the Phase 1 seed script is `applyPreset` without a UI in front of it. Phase 4 adds the wizard. This means the presets get exercised against real tenants for months before a customer ever sees the picker.

### 7.5 Branding and terminology

#### Branding

```jsonc
// tenants.branding
{
  "wordmarkKey": "brand/abc123/wordmark.svg",   // R2 object key, never a URL
  "markKey":     "brand/abc123/mark.png",
  "accent":      "mango",                        // one of six approved keys
  "displayName": "Aqua Club",
  "shortName":   "Aqua"
}
```

Assets are stored in R2 under the tenant prefix and served through signed URLs with a long TTL — brand assets are not sensitive, but keeping every media path uniform means there is no second, laxer code path to get wrong.

**Fallback mark.** When no logo is uploaded, render initials from `shortName` on the accent. Generated as inline SVG at request time, not stored. Every tenant therefore has a usable mark from the moment it is created, which matters because the parent page and the invoice PDF exist before the owner gets around to uploading anything.

**Accent as a runtime token.** The accent is a CSS custom property set once on the document root from the resolved tenant — not a build-time variant, not a stylesheet per tenant.

```tsx
<html style={{ '--accent': ACCENTS[branding.accent].base,
               '--accent-soft': ACCENTS[branding.accent].soft,
               '--accent-ink': ACCENTS[branding.accent].ink }}>
```

`ACCENTS` is a frozen six-entry map in code. An unrecognised key falls back to mango rather than throwing — a bad accent value must never take down a tenant.

Semantic tokens (`--good`, `--late`, `--warn`) are **not** derived from the accent and never change. This is enforced by a lint rule: no component may reference `--accent` inside a status or state style.

#### Terminology — not string replacement

The naive implementation is a find-and-replace over rendered strings. It fails immediately and in ways that look unprofessional:

- **Plurals.** "swimmer" → "swimmers" is fine; "coach" → "coachs" is not. English pluralisation cannot be inferred from a single stored form.
- **Capitalisation.** A term appears mid-sentence, at the start of a sentence, and in a heading. Storing three variants is a data-entry burden that tenants will get wrong.
- **Substring collisions.** Replacing "member" also hits "membership", "remember", and "member_code".
- **Language.** Once Hindi and Bengali land, an override must exist per locale, and neither language pluralises the way English does.

**The model instead:** a closed set of term keys, each carrying explicit forms per locale.

```sql
-- tenants.terminology
{
  "member": { "en": { "one": "swimmer", "other": "swimmers" } },
  "batch":  { "en": { "one": "batch",   "other": "batches"  } }
}
```

```ts
const TERM_KEYS = ['member','batch','coach','session',
                   'program','facility','guardian','enquiry'] as const;
type TermKey = typeof TERM_KEYS[number];

// Resolved once per request into ctx, merged over locale defaults.
export function term(ctx: Ctx, key: TermKey, count: 1 | 'other' = 1): string {
  return ctx.terms[key]?.[count === 1 ? 'one' : 'other']
      ?? DEFAULT_TERMS[ctx.locale][key][count === 1 ? 'one' : 'other'];
}
```

Usage is explicit at the call site, and casing is handled by CSS (`text-transform`) or a formatting helper — never by storing capitalised variants:

```tsx
<h2>{titleCase(term(ctx, 'member', 'other'))}</h2>   // "Swimmers"
<p>{count} {term(ctx, 'member', count === 1 ? 1 : 'other')} marked present</p>
```

**Rules:**

1. `TERM_KEYS` is closed. A new overridable term is a code change, reviewed. This is what makes the feature typed and testable.
2. Overrides layer over locale defaults, per locale. A tenant that overrides `member` in English does not thereby have a Bengali override — it falls back cleanly.
3. Terms never appear in database values, enum values, permission strings, API field names or CSV export headers. Vocabulary is a presentation concern only. The column stays `member_code` whatever the club calls its people.
4. Terms are resolved into the request context once, alongside features and permissions. Never fetched per component.
5. A rendered term is never used to build an identifier, a route, or a lookup key.

#### Where branding must be applied deliberately

These surfaces are outside the normal app shell and are the ones that get forgotten:

| Surface | Note |
|---|---|
| Parent magic-link page | Zero-JS server render; mark and name inlined |
| Invoice, receipt, payslip PDFs | Generated server-side; needs the raster mark, not the SVG, for reliable PDF embedding |
| WhatsApp template header images | Uploaded to the provider per tenant at template registration, not per message |
| Public booking and self-registration | Rendered before any session exists — branding resolved from the slug alone |
| Transactional email | Same as PDFs; inline the mark, do not hotlink |

A snapshot test per surface catches the common regression, which is a new page shipping with our own branding instead of the tenant's.

---

## 8. Data model

### 8.1 Conventions

Applied without exception:

- Primary keys are UUID v7 (time-ordered, index-friendly). Carve-out: time-partitioned, append-only tables that are never targeted by foreign keys may use `bigserial`; `audit_log` is currently the only such table (§8.10). Tenants read that table under its own policy, so index quality still matters
- Every business table carries `tenant_id uuid not null`
- Money is `bigint` in **paise**. Never float, never numeric-for-money
- Timestamps are `timestamptz`, stored UTC, rendered IST
- Soft delete via `deleted_at timestamptz`, with partial indexes excluding deleted rows
- `created_at`, `updated_at`, `created_by`, `updated_by` on every table. Exempt: `audit_log` (self-referential), `webhook_events` (provider-owned payloads), and the platform tables `plans`, `features`, `permissions`, `presets`
- Every index begins with `tenant_id`. Exemption class: GiST exclusion constraints (e.g. `bookings`), where prepending `tenant_id` adds selectivity nothing. Natural-key unique constraints always lead with `tenant_id`

### 8.2 Core tables

```sql
create table tenants (
  id          uuid primary key,
  slug        text unique not null,
  name        text not null,
  plan_id     uuid references plans(id),
  status      text not null default 'trial',  -- trial|active|suspended|churned
  timezone    text not null default 'Asia/Kolkata',
  currency    text not null default 'INR',
  gstin       text,
  branding    jsonb not null default '{}',
  terminology jsonb not null default '{}',    -- {"student":"swimmer"}
  created_at  timestamptz not null default now()
);

create table locations (
  id         uuid primary key,
  tenant_id  uuid not null references tenants(id),
  name       text not null,
  address    jsonb,
  is_primary boolean not null default false,
  deleted_at timestamptz
);
```

#### Identity and access (Phase 1)

Global identity is separate from tenancy: one `users` row per human login, one membership per tenant. Better Auth owns its own internal tables; `users.better_auth_id` is the only coupling point, so library churn costs a data backfill, not a model rewrite.

```sql
create table users (
  id              uuid primary key,
  better_auth_id  text unique,                    -- Better Auth user.id, set at signup
  person_id       uuid references persons(id),    -- nullable; linked when the human exists
  phone           text unique not null,           -- primary auth factor
  email           text,
  last_login_at   timestamptz,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid
);

create index on users (person_id) where deleted_at is null;

create table roles (
  id          uuid primary key,
  tenant_id   uuid not null references tenants(id),
  key         text not null,                      -- template key ('coach'); seeding/analytics only
  name        text not null,                      -- editable display name
  is_system   boolean not null default false,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  unique (tenant_id, key)
);

create table permissions (
  key         text primary key,                   -- 'members.read'
  module      text not null,                      -- feature module this belongs to
  description text not null
);

create table role_permissions (
  role_id        uuid not null references roles(id) on delete cascade,
  permission_key text not null references permissions(key),
  granted_by     uuid,
  granted_at     timestamptz not null default now(),
  primary key (role_id, permission_key)
);

create table tenant_memberships (
  id            uuid primary key,
  tenant_id     uuid not null references tenants(id),
  user_id       uuid not null references users(id),
  role_id       uuid not null references roles(id),
  all_locations boolean not null default true,    -- when true, membership_locations is ignored
  status        text not null default 'invited',  -- invited | active | revoked
  invited_by    uuid,
  joined_at     timestamptz,
  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid,
  unique (tenant_id, user_id)
);

create table membership_locations (
  membership_id uuid not null references tenant_memberships(id) on delete cascade,
  location_id   uuid not null references locations(id),
  primary key (membership_id, location_id)
);
```

RLS: `roles`, `tenant_memberships` and `membership_locations` are tenant-scoped and get the standard enable/force/policy treatment. `users` and `permissions` carry no `tenant_id` — they join the platform-table allowlist (F-08a), and **`users` is reachable only by joining through `tenant_memberships` inside `withTenant()`**; one unscoped query against it would enumerate every user on the platform.

### 8.3 People

One `persons` table for every human, with role-specific extension tables. A coach who is also a member is one person, not two.

```sql
create table persons (
  id            uuid primary key,
  tenant_id     uuid not null references tenants(id),
  full_name     text not null,
  phone         text,
  email         text,
  date_of_birth date,
  gender        text,
  photo_key     text,                        -- R2 object key, never a public URL
  notes         text,
  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid
);

-- Minor status is DERIVED AT READ TIME, never stored:
--   date_of_birth is not null and date_of_birth > :cutoff
-- where :cutoff is computed in application code from the TENANT'S
-- timezone (tenants.timezone), not the database session timezone.
-- A stored value would be invalid (generated columns require immutable
-- expressions; current_date is only STABLE) or stale (a batch update
-- lags the birthday that flips consent requirements).

create index on persons (tenant_id, full_name) where deleted_at is null;
create index on persons (tenant_id, phone)     where deleted_at is null;

create table guardianships (
  id           uuid primary key,
  tenant_id    uuid not null,
  minor_id     uuid not null references persons(id),
  guardian_id  uuid not null references persons(id),
  relationship text not null,
  is_primary   boolean not null default false,
  unique (tenant_id, minor_id, guardian_id)
);

create table members (
  id           uuid primary key,
  tenant_id    uuid not null,
  person_id    uuid not null references persons(id),
  location_id  uuid not null references locations(id),
  member_code  text not null,
  status       text not null,   -- trial|active|paused|lapsed|left
  joined_on    date not null,
  left_on      date,
  unique (tenant_id, member_code)
);

create table staff (
  id          uuid primary key,
  tenant_id   uuid not null,
  person_id   uuid not null references persons(id),
  user_id     uuid references users(id),   -- login, when the person has one
  staff_type  text not null,    -- coach|receptionist|worker|accountant
  employed_on date,
  deleted_at  timestamptz
);
```

**Consent — DPDP obligation, built in from the start:**

```sql
create table consents (
  id             uuid primary key,
  tenant_id      uuid not null,
  person_id      uuid not null references persons(id),
  granted_by     uuid references persons(id),   -- guardian, when subject is a minor
  purpose        text not null,                 -- 'processing'|'photography'|'communications'
  policy_version text not null,
  granted_at     timestamptz not null,
  withdrawn_at   timestamptz,
  evidence       jsonb not null                 -- channel, IP, user agent
);
```

Consent is never a boolean column on `persons`. It is an append-only record with a version and an audit trail, because that is what a regulator asks to see.

### 8.4 Programs, batches, sessions

```sql
create table programs (
  id           uuid primary key,
  tenant_id    uuid not null,
  location_id  uuid not null,
  name         text not null,
  activity     text not null,     -- 'swimming'|'football'
  description  text,
  deleted_at   timestamptz
);

create table batches (
  id            uuid primary key,
  tenant_id     uuid not null,
  program_id    uuid not null references programs(id),
  name          text not null,
  capacity      int not null,
  days_of_week  int[] not null,    -- 0=Sunday
  start_time    time not null,
  end_time      time not null,
  coach_id      uuid references staff(id),
  facility_id   uuid references facilities(id),
  starts_on     date not null,
  ends_on       date,
  deleted_at    timestamptz
);

create table enrolments (
  id           uuid primary key,
  tenant_id    uuid not null,
  member_id    uuid not null references members(id),
  batch_id     uuid not null references batches(id),
  enrolled_on  date not null,
  ended_on     date,
  unique (tenant_id, member_id, batch_id, enrolled_on)
);

create table sessions (
  id          uuid primary key,
  tenant_id   uuid not null,
  batch_id    uuid not null references batches(id),
  session_date date not null,
  start_at    timestamptz not null,
  end_at      timestamptz not null,
  coach_id    uuid references staff(id),
  status      text not null default 'scheduled',  -- scheduled|held|cancelled
  cancel_reason text,
  unique (tenant_id, batch_id, session_date)
);

create index on sessions (tenant_id, session_date, batch_id);
```

Sessions are **materialised**, not computed on the fly. A session is a real thing that can be cancelled, reassigned to a substitute coach, or moved. Generation runs nightly, eight weeks ahead.

### 8.5 Attendance

The highest-volume table in the system.

```sql
create table attendance (
  id          uuid primary key,
  tenant_id   uuid not null,
  session_id  uuid not null references sessions(id),
  member_id   uuid not null references members(id),
  status      text not null,                 -- present|absent|late|excused
  marked_at   timestamptz not null,
  marked_by   uuid not null references staff(id),
  client_id   text not null,                 -- idempotency key from the device
  note        text,
  unique (tenant_id, session_id, member_id)
);

create index on attendance (tenant_id, member_id, marked_at desc);
create index on attendance (tenant_id, session_id);
```

`client_id` is generated on the device before the network call, which makes offline replay idempotent. Upsert on `(tenant_id, session_id, member_id)`, last write wins — meaning last request the database receives, not last human decision. See §12 for what that means when two devices mark the same session and one is offline.

Partition by month once this passes roughly 10 million rows. Not before.

### 8.6 Money

```sql
create table membership_plans (
  id           uuid primary key,
  tenant_id    uuid not null,
  name         text not null,
  program_id   uuid references programs(id),
  kind         text not null,      -- duration|session_pack|one_time
  duration_days int,
  session_count int,
  amount_paise bigint not null,
  tax_rate_bp  int not null default 1800,   -- basis points; 1800 = 18%
  deleted_at   timestamptz
);

create table subscriptions (
  id           uuid primary key,
  tenant_id    uuid not null,
  member_id    uuid not null references members(id),
  plan_id      uuid not null references membership_plans(id),
  starts_on    date not null,
  ends_on      date not null,
  status       text not null,      -- active|paused|expired|cancelled
  paused_from  date,
  paused_until date,
  auto_renew   boolean not null default false,
  mandate_id   text                -- Razorpay e-mandate, Phase 3
);

create index on subscriptions (tenant_id, ends_on) where status = 'active';

create table invoices (
  id              uuid primary key,
  tenant_id       uuid not null,
  location_id     uuid not null,
  member_id       uuid not null references members(id),
  invoice_number  text not null,          -- gapless, per FY, per location
  financial_year  text not null,
  issued_on       date not null,
  due_on          date not null,
  subtotal_paise  bigint not null,
  tax_paise       bigint not null,
  total_paise     bigint not null,
  paid_paise      bigint not null default 0,
  status          text not null,          -- draft|issued|partial|paid|void
  unique (tenant_id, location_id, financial_year, invoice_number)
);

create index on invoices (tenant_id, status, due_on);

create table payments (
  id                uuid primary key,
  tenant_id         uuid not null,
  invoice_id        uuid references invoices(id),
  member_id         uuid not null,
  amount_paise      bigint not null,
  method            text not null,        -- cash|upi|card|netbanking|bank_transfer
  channel           text not null,        -- online|counter
  received_at       timestamptz not null,
  received_by       uuid references staff(id),
  gateway_payment_id text unique,         -- null for cash
  gateway_order_id  text,
  reference         text,
  status            text not null         -- pending|captured|failed|refunded
);
```

**Invoice numbering** must be gapless per financial year per location — a GST requirement. It is issued inside the invoice transaction using a per-scope counter row with `select ... for update`, never a sequence (sequences leave gaps on rollback).

**Cash matters.** A meaningful share of collections in this market is cash at the counter. `channel = 'counter'` with a recorded `received_by` and a daily reconciliation report is not an afterthought; if the product cannot handle cash, the register survives.

### 8.7 Facilities and bookings (Phase 3)

```sql
create table facilities (
  id           uuid primary key,
  tenant_id    uuid not null,
  location_id  uuid not null,
  name         text not null,
  kind         text not null,          -- pool|court|turf|studio
  capacity     int not null,
  sub_units    jsonb not null default '[]',   -- lanes, courts
  deleted_at   timestamptz
);

create table bookings (
  id           uuid primary key,
  tenant_id    uuid not null,
  facility_id  uuid not null references facilities(id),
  sub_unit     text,
  person_id    uuid references persons(id),
  guest_name   text,
  guest_phone  text,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  party_size   int not null default 1,
  status       text not null,          -- held|confirmed|cancelled|no_show
  invoice_id   uuid references invoices(id),
  exclude      tstzrange generated always as (tstzrange(starts_at, ends_at)) stored
);
```

Double-booking is prevented by the database, not by application logic:

```sql
create extension if not exists btree_gist;

alter table bookings add constraint no_overlap
  exclude using gist (
    facility_id with =,
    coalesce(sub_unit, '') with =,
    exclude with &&
  ) where (status in ('held', 'confirmed'));
```

An exclusion constraint is race-proof under concurrency in a way that a check-then-insert never is.

### 8.8 Swimming vertical (Phase 3)

```sql
create table skill_levels (
  id         uuid primary key,
  tenant_id  uuid not null,
  program_id uuid not null,
  name       text not null,
  ordinal    int not null
);

create table skills (
  id         uuid primary key,
  tenant_id  uuid not null,
  level_id   uuid not null references skill_levels(id),
  name       text not null,          -- 'freestyle', 'backstroke', 'breathing'
  rubric     jsonb not null          -- descriptors per band
);

create table assessments (
  id           uuid primary key,
  tenant_id    uuid not null,
  member_id    uuid not null,
  skill_id     uuid not null references skills(id),
  band         int not null,         -- 1..4, drives the progress pips in the UI
  assessed_at  timestamptz not null,
  assessed_by  uuid references staff(id),
  note         text
);

create index on assessments (tenant_id, member_id, assessed_at desc);

create table facility_logs (
  id          uuid primary key,
  tenant_id   uuid not null,
  facility_id uuid not null,
  kind        text not null,        -- chemistry|maintenance|incident
  payload     jsonb not null,       -- {"chlorine_ppm":1.4,"ph":7.4}
  logged_at   timestamptz not null,
  logged_by   uuid references staff(id)
);
```

### 8.9 Staff attendance, shifts and pay (Phase 3)

The largest cost line in the tenant's business, and the input that turns the owner dashboard from revenue into profit.

**Design note:** session-based coach pay is *derived*, not entered. The system already knows which sessions were held and who actually took them, including substitutions. Payout computation is a read over `sessions` plus `pay_rules`, not a data-entry screen.

```sql
create table shift_templates (
  id           uuid primary key,
  tenant_id    uuid not null,
  location_id  uuid not null,
  name         text not null,
  start_time   time not null,
  end_time     time not null,
  days_of_week int[] not null
);

create table shifts (
  id           uuid primary key,
  tenant_id    uuid not null,
  staff_id     uuid not null references staff(id),
  location_id  uuid not null,
  shift_date   date not null,
  start_at     timestamptz not null,
  end_at       timestamptz not null,
  status       text not null default 'rostered',  -- rostered|worked|absent|leave
  unique (tenant_id, staff_id, shift_date, start_at)
);

create index on shifts (tenant_id, shift_date, staff_id);

create table staff_attendance (
  id           uuid primary key,
  tenant_id    uuid not null,
  staff_id     uuid not null references staff(id),
  shift_id     uuid references shifts(id),
  work_date    date not null,
  checked_in_at  timestamptz,
  checked_out_at timestamptz,
  method       text not null,          -- self_qr|self_app|manual
  marked_by    uuid references staff(id),   -- set only when method = manual
  late_minutes int not null default 0,
  status       text not null,          -- present|absent|half_day|leave|holiday
  note         text,
  client_id    text not null,
  unique (tenant_id, staff_id, work_date)
);

create index on staff_attendance (tenant_id, work_date, staff_id);

create table leave_types (
  id            uuid primary key,
  tenant_id     uuid not null,
  name          text not null,         -- casual|sick|unpaid
  annual_quota  int,
  is_paid       boolean not null default true
);

create table leave_requests (
  id            uuid primary key,
  tenant_id     uuid not null,
  staff_id      uuid not null references staff(id),
  leave_type_id uuid not null references leave_types(id),
  from_date     date not null,
  to_date       date not null,
  days          numeric(4,1) not null,
  reason        text,
  status        text not null default 'pending',  -- pending|approved|rejected|cancelled
  decided_by    uuid references staff(id),
  decided_at    timestamptz
);

create index on leave_requests (tenant_id, staff_id, from_date);
```

**Compensation.** One staff member may hold several concurrent rules — a monthly retainer plus a per-session rate for extra batches is common.

```sql
create table pay_rules (
  id            uuid primary key,
  tenant_id     uuid not null,
  staff_id      uuid not null references staff(id),
  kind          text not null,        -- monthly|per_session|per_hour|per_head
  amount_paise  bigint not null,
  program_id    uuid references programs(id),   -- null = applies to all
  batch_id      uuid references batches(id),    -- null = applies to all
  effective_from date not null,
  effective_to  date,
  deleted_at    timestamptz
);

create index on pay_rules (tenant_id, staff_id, effective_from);

create table advances (
  id             uuid primary key,
  tenant_id      uuid not null,
  staff_id       uuid not null references staff(id),
  amount_paise   bigint not null,
  reason         text,
  given_on       date not null,
  given_by       uuid references staff(id),
  instalments    int not null default 1,
  outstanding_paise bigint not null,
  status         text not null default 'open'   -- open|settled|written_off
);

create table payout_runs (
  id            uuid primary key,
  tenant_id     uuid not null,
  location_id   uuid not null,
  period_month  date not null,        -- first of the month
  status        text not null default 'draft',  -- draft|approved|paid|locked
  approved_by   uuid references staff(id),
  approved_at   timestamptz,
  unique (tenant_id, location_id, period_month)
);

create table payout_lines (
  id             uuid primary key,
  tenant_id      uuid not null,
  run_id         uuid not null references payout_runs(id),
  staff_id       uuid not null references staff(id),
  kind           text not null,       -- earning|deduction
  label          text not null,       -- 'Sessions taken', 'Advance recovery'
  quantity       numeric(8,2),        -- 34 sessions, 12 days
  rate_paise     bigint,
  amount_paise   bigint not null,
  source         text not null,       -- derived|manual
  source_ref     jsonb                -- session ids behind a derived line
);

create table payouts (
  id             uuid primary key,
  tenant_id      uuid not null,
  run_id         uuid not null references payout_runs(id),
  staff_id       uuid not null references staff(id),
  gross_paise    bigint not null,
  deduction_paise bigint not null,
  net_paise      bigint not null,
  paid_at        timestamptz,
  method         text,                -- cash|bank_transfer|upi
  reference      text,
  unique (run_id, staff_id)
);
```

**`source_ref` matters.** When a coach disputes their payout — and they will — the owner needs to open the line and see the thirty-four specific sessions behind it. A derived number with no audit trail is worse than a manual one.

#### Payout computation

```
For each staff member in the period:
  monthly rules    → prorated by staff_attendance days present
  per_session      → count sessions where status = 'held'
                     AND coach_id = this staff member
                     (substitutions naturally land on whoever took it)
  per_hour         → sum of checked_in/checked_out durations
  per_head         → sum of attendance rows marked present in their sessions
  + manual bonus / incentive lines
  − advance instalments due this period
  − unpaid leave days
  = net payable
```

Runs as a job on the first of each month, producing a **draft**. It is never auto-paid. The owner reviews, adjusts, approves, and the run locks. A locked run cannot be edited — corrections go into the next period as an adjustment line, exactly as an accountant would expect.

#### Batch profitability

Once pay rules exist, this becomes a straightforward join and it is a report no competitor currently offers:

```sql
-- revenue per batch  vs  coach cost per batch, per month
-- surfaces the 4-student batch that loses money every time it runs
```

This is the single most valuable thing that falls out of building staff pay, and it is the argument for doing it in Phase 3 rather than deferring.

#### Permissions

Compensation is the most sensitive data in the tenant and gets its own permission axis, separate from `staff.read`:

| Permission | Grants |
|---|---|
| `staff.read` | Staff list, contact details, roles |
| `staff.attendance` | Mark and view staff attendance |
| `staff.roster` | Build and publish shifts, approve leave |
| `staff.pay.read` | View pay rules, payout amounts, payslips |
| `staff.pay.write` | Set rates, run payouts, approve, record payment |

A receptionist who marks staff attendance must not see what the head coach earns. **Reads of pay data are written to the audit log**, not only writes — this is the one table where knowing who looked matters as much as knowing who changed it.

### 8.10 Audit

```sql
create table audit_log (
  id          bigserial primary key,
  tenant_id   uuid,
  actor_id    uuid,
  impersonator_id uuid,
  action      text not null,        -- 'member.update'
  entity_type text not null,
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  ip          inet,
  created_at  timestamptz not null default now()
);

create index on audit_log (tenant_id, created_at desc);
create index on audit_log (tenant_id, entity_type, entity_id);
```

Written for every mutation, in the same transaction as the change. Append-only — no update or delete grants. Partition by month from the start; this table grows fastest and is queried least.

**RLS policy — strict tenant isolation even though `tenant_id` is nullable:**

```sql
alter table audit_log enable row level security;
alter table audit_log force row level security;

create policy tenant_isolation on audit_log
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
```

Rows with NULL `tenant_id` are platform actions; they are invisible to tenant-scoped requests, and platform reads go through the privileged role. Deliberately **not** allowlisted for F-08a: this table records who looked at pay data, and an allowlist would let any future unscoped query path read it across all tenants. Tenants read their own trail through the normal accessor — which is why index quality matters here despite the bigserial carve-out (§8.1).

---

## 9. Background jobs

pg-boss, on the same database. Transactional job enqueueing is a real benefit: a job scheduled in the same transaction as the row it operates on cannot reference a row that was rolled back.

| Job | Schedule | Purpose |
|---|---|---|
| `sessions.generate` | Nightly 02:00 IST | Materialise sessions eight weeks ahead |
| `subscriptions.expire` | Nightly 02:15 | Mark lapsed, fire notifications |
| `invoices.generate` | Nightly 02:30 | Raise invoices for renewing subscriptions |
| `dunning.run` | Daily 09:00 | Reminder ladder at 3, 7, 14, 30 days overdue |
| `mandates.prenotify` | Daily 08:00 | Send pre-debit notices for upcoming auto-debits. A debit cannot run without one |
| `mandates.debit` | Daily 10:00 | Execute due debits, skipping any opted out or un-notified |
| `notifications.send` | Continuous | Outbound WhatsApp and email queue |
| `attendance.alerts` | Daily 20:00 | Absence streaks and low-attendance alerts |
| `payouts.draft` | 1st of month, 04:00 | Compute draft staff payouts from sessions, attendance and pay rules. Never auto-pays |
| `reports.rollup` | Nightly 03:00 | Precompute daily summaries |
| `usage.meter` | Hourly | Per-tenant message and storage counters |
| `webhooks.process` | Continuous | Payment webhook consumption |
| `webhooks.purge` | Nightly 03:15 | Delete processed webhook events older than 90 days |

**Rules:** every job is idempotent and re-runnable. Every job takes `tenant_id` and runs inside `withTenant`. Retries use exponential backoff, three attempts, then dead-letter with an alert. No job runs longer than five minutes — chunk instead.

**Time zone trap:** all schedules are IST. Session generation must use the tenant's timezone, not the server's, or a 6:00 AM batch lands at the wrong instant.

---

## 10. Payments integration

### 10.1 Flow

```
Invoice issued
   → Razorpay order created (receipt = invoice id)
   → Payment link sent via WhatsApp
   → Member pays (UPI / card / netbanking)
   → Webhook received
   → Signature verified
   → Stored raw, queued
   → Worker applies payment, updates invoice, emits receipt
```

### 10.2 Webhook idempotency

Razorpay retries. Duplicate receipts destroy trust immediately, so the webhook endpoint does the minimum and returns fast:

```ts
export async function POST(req: Request) {
  const raw = await req.text();
  const sig = req.headers.get('x-razorpay-signature')!;
  if (!verifySignature(raw, sig, env.RAZORPAY_WEBHOOK_SECRET)) {
    return new Response('invalid', { status: 400 });
  }

  const event = JSON.parse(raw);

  // Dedupe on the provider's event id — a duplicate delivery is a no-op.
  await platformDb.insert(webhookEvents)
    .values({
      id: generateUuidV7(),               // our id, never the provider's
      provider: 'razorpay',
      providerEventId: event.id,
      payload: event,
    })
    .onConflictDoNothing();

  await boss.send('webhooks.process', { eventId: event.id });
  return new Response('ok');           // under 50ms
}
```

Signature verification happens before parsing. Processing happens in the worker, where a failure can retry without Razorpay re-delivering.

**Storage:**

```sql
create table webhook_events (
  id                uuid primary key,             -- our uuid v7, never the provider's id
  provider          text not null,                -- 'razorpay'
  provider_event_id text not null,
  payload           jsonb not null,               -- raw body, stored before interpretation
  received_at       timestamptz not null default now(),
  processed_at      timestamptz,
  unique (provider, provider_event_id)
);

create index on webhook_events (received_at);
```

Uniqueness on `(provider, provider_event_id)` is what makes `onConflictDoNothing()` a deduplication. Retention: 90 days — disputes and settlement mismatches surface well inside that, and beyond it the payment and invoice rows are the record of truth. The `webhooks.purge` job deletes processed events past that age; `processed_at` doubles as the debug handle for dead-lettered events.

### 10.3 Reconciliation

A daily job pulls Razorpay settlements and matches them against recorded payments. Mismatches raise an alert rather than silently self-correcting. Counter cash is reconciled separately against the daily collection report and a staff-confirmed cash count.

### 10.4 UPI auto-debit (Phase 3)

E-mandate registration at subscription creation, then scheduled debits ahead of the renewal date. Mandate failures fall back to the normal dunning ladder rather than silently lapsing the membership.

**Sizing is favourable.** Recurring debits up to ₹15,000 per transaction clear without additional authentication once a mandate is registered. Academy fees of ₹2,000–5,000 sit well inside that band, so no re-authentication friction applies.

#### Pre-debit notification — mandatory

The RBI e-mandate framework requires the customer be notified in advance of every charge, with the ability to opt out of that debit or revoke the mandate entirely. **Sources disagree on the window — 24 versus 72 hours. Verify against Razorpay's current documentation before implementing.**

```sql
create table mandate_notices (
  id            uuid primary key,
  tenant_id     uuid not null,
  subscription_id uuid not null references subscriptions(id),
  scheduled_debit_at timestamptz not null,
  amount_paise  bigint not null,
  notified_at   timestamptz,
  opted_out_at  timestamptz,
  status        text not null default 'pending',  -- pending|notified|opted_out|debited|failed
  unique (subscription_id, scheduled_debit_at)
);
```

**Job:** `mandates.prenotify` runs daily, finds debits inside the notification window, sends the notice, records it. A debit **must not** execute without a recorded `notified_at` — enforce this as a guard in the debit job, not a convention.

**Opt-out path:** the notice carries a link that marks `opted_out_at` and cancels that cycle's debit. The subscription stays active and falls into the dunning ladder. Opting out of one debit is not cancelling the membership, and the flow must not conflate them.

#### The retention consequence

This notice is a monthly moment where every paying parent is reminded they can cancel. That is a product problem, not a compliance one.

The notice should be tenant-branded and carry something worth reading — the child's attendance that month, a recent progress note, the next session date — alongside the amount. A bare debit warning is an invitation to opt out. Build it through the same branded template path as receipts, not as a plain system message.

---

## 11. Messaging

### 11.1 Provider abstraction

```ts
interface MessageProvider {
  send(msg: {
    to: string;
    template: string;
    category: 'utility' | 'marketing' | 'authentication';
    variables: Record<string, string>;
    tenantId: string;
  }): Promise<{ providerMessageId: string; costPaise: number }>;
}
```

Start with a BSP for speed of setup. Move to the Cloud API directly when volume justifies it. Nothing above the interface changes.

**Email fallback provider: AWS SES, Mumbai region** — chosen for cost and in-region latency. Used when WhatsApp delivery fails or no phone number exists; metered identically (§11.2).

### 11.2 Cost control — a first-class concern

WhatsApp is the largest variable cost in the business and scales with member count rather than plan price.

- **Every automated message is a utility template.** Marketing templates cost roughly seven to eight times as much. A message that is not fee-related, session-related or receipt-related does not get sent automatically.
- **Meter per tenant per month.** Count and cost, recorded at send time.
- **Enforce quota by plan.** Warn at 80%, soft-block marketing at 100%, never block a fee reminder or a receipt.
- **Use the free service window.** When a parent replies, the following 24 hours are free — route support conversation into that window rather than sending templates.
- **Check consent suppression at send.** Every send consults the recipient's per-purpose withdrawal state (scope §7.1); `message_log.consent_class` records whether the message was essential or suppressible, making suppression queryable and auditable rather than implicit in template names.

```sql
create table message_log (
  id          uuid primary key,
  tenant_id   uuid not null,
  person_id   uuid,
  template    text not null,
  category    text not null,     -- whatsapp template category: utility|marketing|authentication
  consent_class text not null,   -- 'essential'|'suppressible'; checked against withdrawal state at send
  provider_id text,
  cost_paise  int not null,
  status      text not null,     -- queued|sent|delivered|read|failed
  sent_at     timestamptz
);

create index on message_log (tenant_id, sent_at desc);
```

### 11.3 Parent magic links

```
Signed token → /p/{token} → server-rendered page, no bundle
```

Payload holds person id, tenant id, scope and expiry; signed with a rotating secret; single-purpose (a fee link cannot read progress); 7-day expiry; revocable. Zero client JavaScript, no analytics, no tracking — a DPDP requirement on any surface serving children's data.

---

## 12. Offline attendance

The one place worth serious engineering effort. A coach who loses a register to a dropped connection stops trusting the product that day.

```
Coach marks     → optimistic UI update (<100ms)
                → write to IndexedDB queue with client_id
                → attempt POST
     online      → success, mark synced
     offline     → retain in queue, register service worker sync
      reconnect   → replay queue in order, upsert by (tenant_id, session_id, member_id)
```

Conflict resolution is last-write-**to-the-server**-wins — the upsert on `(tenant_id, session_id, member_id)` simply applies whichever request the database receives last, with `marked_at` set to that request's execution time. It does **not** compare timestamps to find the most recent human decision. This is coach-visible behaviour, not an implementation detail: if a device goes offline after marking, then reconnects after a second device has already marked the same member online, the offline device's mark wins on reconnect — even though it was the *earlier* decision in wall-clock time. Verified directly (S3): two devices, one offline, mark the same member differently; the offline device's mark was made first but reached the server last, and it won.

This is the correct rule for this product — a coach handing off a register mid-session with patchy signal needs their device's marks to land, not silently lose to whoever happened to have signal first — but it means a substitution handover (two coaches marking the same session, one offline) resolves by reconnect order, not by who decided later. Worth knowing before it gets "discovered" as a bug during a handover and re-litigated as one.

The UI always shows sync state — "11 of 14 marked · saves offline too" — because silent queues erode trust as badly as lost data.

Service worker caches the app shell, today's sessions and today's rosters. Nothing else needs to work offline in Phases 1–3.

---

## 13. Frontend architecture

### 13.1 Composition

- Server Components by default. Client components are islands: the attendance marker, the booking calendar, the POS keypad, and the charts.
- Server Actions for mutations, with Zod validation and a permission check as the first two statements of every action.
- Route handlers only for webhooks and public endpoints.
- No global client state library. URL state plus server state covers this product.

### 13.2 Route structure

```
app/
  (platform)/          control plane — separate auth, Phase 4
  (tenant)/[slug]/
    (owner)/           dashboard, reports, settings
    (staff)/           members, batches, attendance, fees, bookings
    (coach)/           today, register, assessments
    (worker)/          tasks
  p/[token]/           parent magic-link pages, zero JS
  book/[slug]/         public booking, minimal JS
  api/webhooks/
```

Role groups are separate layouts, not conditional rendering inside one dashboard. This is what makes role-first UX real rather than aspirational — a worker's bundle does not contain the owner's reports.

### 13.3 Performance budget in CI

```js
// next.config.js — build fails over budget
experimental: { bundlePagesRouterDependencies: true },
```

```yaml
- run: pnpm build
- run: pnpm exec bundlesize   # first-load JS < 150KB gz
- run: pnpm exec lhci autorun # mobile perf > 90
```

Non-negotiable rules for generated code:

- Icons imported individually from `lucide-react` — never the barrel
- No chart library on any mobile route; charts render server-side as SVG or lazy-load behind interaction
- No component library beyond copied shadcn/ui source
- Fonts self-hosted, subset, `font-display: swap`
- Every image through `next/image` with explicit dimensions

---

## 14. Observability

| Concern | Tool |
|---|---|
| Errors | Sentry, with tenant id and user id as tags |
| Structured logs | JSON to stdout, shipped by the platform |
| Product analytics | PostHog, **staff surfaces only** |
| Uptime | External synthetic check on a health endpoint |
| Business audit | `audit_log` table |

**Alerts that page:** webhook processing failure, job dead-letter, payment reconciliation mismatch, error rate above 1%, database connections above 80%.

**Alerts that do not page:** anything else. Alert fatigue on a two-person team is worse than no alerting.

Every log line and Sentry event carries `tenant_id`. Debugging a report of "it's broken" without knowing which tenant is a wasted hour.

---

## 15. Security

| Control | Implementation |
|---|---|
| Tenant isolation | RLS, forced, non-owner role, CI test |
| Transport | TLS everywhere, HSTS |
| Secrets | Platform secret store, never in the repo, rotated quarterly |
| Media | R2 private buckets, signed URLs with short expiry. **No public URL ever resolves to a photo of a child** |
| Rate limiting | Per-IP on OTP and login, per-tenant on API |
| OTP | 6 digits, 5-minute expiry, 5 attempts, then lockout |
| SQL injection | Parameterised queries only; Drizzle default |
| Dependencies | Dependabot, weekly review |
| Impersonation | Platform-only, requires a reason, always audited, banner visible to the impersonating user |
| Backups | Daily, 30-day retention, **restore tested quarterly** |

An untested backup is not a backup.

---

## 16. Data migration and onboarding

Treated as a first-class product feature, because migration friction is the single largest cause of churn in this segment and, at this ARPU, onboarding cost *is* margin.

```
Upload CSV/XLSX → detect columns → map to fields → validate
   → dry-run preview showing exactly what will be created
   → confirm → import inside one transaction → summary + undo window
```

Requirements: mapping presets for known competitors' export formats, per-row error reporting with a downloadable failures file, idempotent re-import via an external reference column, and a full undo for 24 hours.

Support flow for the common case — a WhatsApp group and a paper register — is a guided template download rather than a bespoke import.

---

## 17. Repository structure

```
/app                 Next.js routes, grouped by role
/components          shared UI, shadcn source
/db
  /schema            Drizzle table definitions, one file per domain
  /migrations        plain SQL, checked in, forward-only
  tenant.ts          withTenant — the sanctioned accessor
  client.ts          raw client, platform use only, lint-restricted
/lib
  /auth              session, permissions, context
  /features          entitlement resolution
  /payments          Razorpay adapter
  /messaging         provider interface + BSP adapter
  /jobs              pg-boss handlers
  /money             paise helpers, formatting, tax
/workers             worker entrypoint
/tests
  isolation.test.ts  the CI gate
DESIGN.md
docs/architecture.md
docs/project-scope.md
docs/implementation-plan.md
docs/testing-strategy.md
docs/agent-setup.md
```

**Testing priority — not uniform coverage:**

1. Tenant isolation
2. Money paths — invoice totals, tax, partial payments, refunds, webhook idempotency
3. Entitlement resolution
4. Attendance offline replay
5. Everything else, as needed

Have the model write these tests before the corresponding feature.

---

## 18. Deferred to later phases

| Item | Revisit when |
|---|---|
| Redis and BullMQ | pg-boss exceeds ~1,000 jobs/minute |
| Read replica | Report queries measurably affect write latency |
| Attendance partitioning | Table passes ~10 million rows |
| Custom domains per tenant | A tenant asks and will pay |
| Native mobile app | Offline needs exceed what a PWA delivers |
| Control plane UI | Around tenant five — until then, SQL and a seed script |
| Search infrastructure | Postgres full-text stops being sufficient |
| CDN for media | R2 already fronts this adequately |

Each of these is a real cost in operational complexity. None is justified by Phase 1–3 load.

---

## 19. Phase build order

### Phase 1 — Foundation (5–6 weeks)

1. Repo, CI, performance budget, `DESIGN.md`
2. Schema: tenants, locations, users, memberships, roles, permissions
3. RLS policies and `withTenant`, plus the isolation test **before any feature code**
4. Better Auth with phone OTP
5. Feature registry and entitlement resolution
6. Audit log
7. App shell, design tokens, navigation, role layouts
8. Preset definitions (§7.4) plus `applyPreset` — used as the internal provisioning mechanism from tenant one, no UI until Phase 4

**Gate:** two tenants coexist, isolation test passes, a feature toggle changes what the UI renders.

### Phase 2 — Operating core (8–10 weeks)

1. Persons, guardianships, members, staff, consent
2. Excel importer
3. Enquiries and follow-ups
4. Programs, batches, enrolments, session generation
5. Attendance with offline queue
6. Membership plans, subscriptions
7. Invoicing with gapless numbering
8. Payments — cash first, then Razorpay
9. Webhook pipeline
10. WhatsApp provider, templates, metering
11. Parent magic-link pages
12. Owner dashboard

**Gate:** the reference business completes one full month in the product without the register.

### Phase 3 — Swimming vertical, staff pay and go-live (7–8 weeks)

1. Facilities, lanes, exclusion constraint
2. Slots, bookings, public booking page
3. Closures and maintenance
4. Skill levels, rubrics, assessments, progress history
5. Facility logs — chemistry, incidents
6. Dunning ladder
7. UPI e-mandate
8. Staff attendance, shift roster, leave with balances
9. Pay rules, advances, payout computation, approval and payslips
10. Reporting suite including batch profitability and monthly P&L
11. QR self check-in, public self-registration
12. Backup restore drill, load test, security review

Items 8 and 9 depend on sessions and substitution handling from Phase 2 being correct. Build them after the register has run live for a few weeks, so payout computation is reading trustworthy data.

**Gate:** the owner would be materially inconvenienced if the product disappeared.

---

## 20. Decisions to revisit

| Decision | Trigger to reconsider |
|---|---|
| Monolith | Sustained CPU saturation that vertical scaling cannot absorb |
| Shared database | A tenant contractually requires physical isolation |
| pg-boss | Job latency becomes user-visible |
| PWA only | Coaches report unacceptable offline behaviour |
| BSP for WhatsApp | Volume makes direct Cloud API cheaper than the markup |
| Razorpay only | Settlement terms or reliability become a problem |
| No dark mode | Users ask — they probably will not |

Everything here is reversible except the data model and tenant isolation. Those two get built carefully and by hand; the rest can be regenerated.
