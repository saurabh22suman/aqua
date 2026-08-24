# Agent setup — Aqua

**How to prepare the environment before an agent executes a single task from `implementation-plan.md`.**

| | |
|---|---|
| Purpose | Tooling, docs access, project skills and guardrails for AI-assisted development |
| Do this | Before task S-01 |
| Companions | `implementation-plan.md`, `architecture.md`, `project-scope.md`, `DESIGN.md` |

> **Verify before you copy.** Agent tooling moves fast — install commands, package names and MCP endpoints below were accurate when written and may have changed. Check the linked source before running anything.

---

## 1. Why this document exists

An agent writing code for this project has two failure modes, and both are addressed here rather than in the plan.

**It writes confidently from stale training data.** Next.js APIs, Better Auth, Drizzle, Razorpay and the WhatsApp Cloud API all change faster than any model's knowledge cutoff. Left alone, an agent will produce code that looks right, compiles, and uses an API that was deprecated two releases ago. Section 4 fixes this.

**It re-derives conventions every session.** Without persistent context it will reinvent the tenant-scoping pattern, pick a new shade of blue, or write a migration by hand. Sections 3 and 5 fix this.

The rule underneath both: **encode every repeated procedure as a file the agent can find.**

---

## 2. Prerequisites

### 2.1 Local machine

| Tool | Version | Note |
|---|---|---|
| Node | 22 LTS | Pin with `.nvmrc` |
| pnpm | latest | Faster installs, stricter resolution than npm |
| Docker Desktop | latest | Local Postgres 16 |
| Git | latest | |
| Coding agent | Claude Code, or any agent supporting the Agent Skills standard | |

### 2.2 Accounts to create first

Nothing blocks harder than an agent halfway through a task discovering it has no credentials.

| Service | Needed by | Get before |
|---|---|---|
| Postgres (Neon or DigitalOcean, **Mumbai region**) | Everything | S-03 |
| Cloudflare R2 | Media, brand assets | F-17 |
| Sentry | Errors | S-06 |
| Razorpay (test mode) | Payments | C-35 |
| WhatsApp BSP (Interakt / AiSensy / Gupshup) | Messaging | C-40 |
| Context7 API key | Doc lookups | Now |
| GitHub | Repo, CI | S-05 |

Store everything in a password manager. `.env.example` lists variable names only — never values, and never a real key in a file an agent can read and echo into a log.

---

## 3. Agent context files

### 3.1 The hierarchy

```
CLAUDE.md              ← repo root. Always loaded. Keep it SHORT.
AGENTS.md              ← symlink to CLAUDE.md for non-Claude agents
DESIGN.md              ← design tokens and rules
architecture.md        ← referenced, not auto-loaded
implementation-plan.md ← referenced, not auto-loaded
.claude/
  skills/              ← project skills, travel with the repo
  settings.json        ← MCP servers, hooks, permissions
db/CLAUDE.md           ← directory-scoped rules
app/CLAUDE.md          ← directory-scoped rules
```

### 3.2 Root CLAUDE.md

Keep this **under 100 lines**. It loads on every request — bloat here costs context on every single task and gets skimmed rather than read.

```markdown
# Aqua

Multi-tenant SaaS for sports academies in India. Next.js 15 · TypeScript ·
Postgres · Drizzle · Better Auth · pg-boss · Razorpay · WhatsApp.

## Before writing code
- Task list: `implementation-plan.md`. Work one task at a time, in order.
- Technical decisions: `architecture.md`. Read the sections the task names.
- Visual rules: `DESIGN.md`. Non-negotiable.
- Library APIs: **look them up with Context7 first.** See §4 of agent-setup.md.

## Absolute rules
- Tenant data ONLY through `withTenant()`. Never import `@/db/client`.
- Money is `bigint` paise. Never float, never numeric.
- Timestamps `timestamptz`, stored UTC, displayed IST.
- Every mutation writes `audit_log` in the same transaction.
- TypeScript strict. No `any`. Zod at every boundary.
- Files under 300 lines.
- Icons: individual imports from lucide-react. Never the barrel.
- No new dependency without asking.
- Never edit an applied migration. Add a new one.

## Verify before claiming done
pnpm typecheck && pnpm lint && pnpm test && pnpm build

## Stop and ask when
- A task needs a table or column not in the plan
- The bundle budget would be exceeded
- Anything about money, tenant isolation or children's data is ambiguous
```

### 3.3 Directory-scoped files

Loaded only when the agent works in that directory. This is where detail belongs.

**`db/CLAUDE.md`**

```markdown
# Database

Every tenant-scoped table needs, without exception:
- `tenant_id uuid not null references tenants(id)`
- `enable row level security` AND `force row level security`
- a `tenant_isolation` policy (using + with check)
- every index starting with `tenant_id`
- `created_at`, `updated_at`, `created_by`, `updated_by`
- `deleted_at` where soft delete applies, with partial indexes

Use the `rls-table` skill. Do not hand-write this.

Migrations are forward-only and checked in. Never edit an applied migration.
`app_user` is not the table owner and must never be granted BYPASSRLS.

`users` is reached only by joining through `tenant_memberships` inside
`withTenant()`. Never query `users` directly from tenant code — it has no
`tenant_id`; one bad query enumerates every user on the platform.
```

**`app/CLAUDE.md`**

```markdown
# Application

Server Components by default. Client components only for: attendance marker,
booking calendar, POS keypad, charts.

Every Server Action opens with:
1. Zod parse of input
2. requirePermission(ctx, '...')

Role route groups have separate layouts. Never conditionally render one
dashboard for multiple roles — a worker's bundle must not contain owner code.

Every list needs a designed empty state with a verb CTA. Skeletons, not spinners.
```

---

## 4. Documentation access — the important part

### 4.1 Context7

Gives the agent current, version-specific library docs instead of training-data recall. Two ways to install; pick one.

**MCP mode** — `.claude/settings.json`:

```json
{
  "mcpServers": {
    "context7": {
      "url": "https://mcp.context7.com/mcp",
      "headers": { "Authorization": "Bearer ${CONTEXT7_API_KEY}" }
    }
  }
}
```

**CLI + skill mode** — `ctx7 setup` installs a skill that triggers doc lookups without an MCP server. Lighter, and one fewer moving part.

A free key at context7.com/dashboard raises rate limits. Note that Context7's library entries are community-contributed, so treat a doc lookup as strong evidence rather than gospel — if it contradicts the official docs, the official docs win.

### 4.2 Libraries that MUST be looked up before use

This is the highest-value table in this document. Every entry is something an agent will otherwise get confidently wrong.

| Library | Why training data fails |
|---|---|
| **Next.js 15 App Router** | Server Actions, caching semantics and `params` handling have all changed across recent majors. Models blend versions |
| **Better Auth** | Young and moving fast. Plugin APIs and the organisation model change between minors |
| **Drizzle ORM** | RLS helpers, relational query API and migration tooling have all shifted |
| **Tailwind v4** | Config format changed substantially from v3. Models default to v3 syntax |
| **Razorpay** | Webhook payload shapes, e-mandate and UPI Autopay flows change; Indian regulation drives updates |
| **WhatsApp Cloud API** | Pricing model moved to per-message in January 2026. Template categories and rules change often |
| **pg-boss** | Job options and the scheduling API changed across majors |
| **shadcn/ui** | Component source changes; copy current source rather than recalling it |

**Rule for the agent, stated in CLAUDE.md:** before writing code against any library in this table, fetch its current docs. Not optional, not "if unsure."

### 4.3 Other MCP servers worth adding

| Server | Value | Priority |
|---|---|---|
| **Postgres** | Agent inspects real schema and query plans instead of guessing | High |
| **Playwright** | Verifies UI actually renders and works — closes the loop on frontend tasks | High |
| **GitHub** | Reads issues, opens PRs | Medium |
| **Sentry** | Pulls real errors when debugging | Low until live |

Restrict the Postgres MCP to a **local or staging** database. An agent with production credentials is a bad day waiting to happen.

---

## 5. Project skills

A skill is a folder with a `SKILL.md` — YAML frontmatter plus markdown instructions. The frontmatter needs `name` and `description`. **If the frontmatter is malformed the skill is skipped silently**, with no error, so validate it before debugging anything else.

The `description` is the trigger. Write it as a clear answer to "when should the agent use this?" A vague description means the skill never fires.

Repo-level skills go in `.claude/skills/` and travel with the project. The format is an open standard, so these work in Cursor, Codex and Gemini CLI too.

### 5.1 Skills to author before starting

| Skill | Encodes | Author before |
|---|---|---|
| `execute-task` | The plan's task loop and verification gate | S-01 |
| `rls-table` | Creating a tenant-scoped table correctly | F-01 |
| `drizzle-migration` | Generate, review, apply | F-01 |
| `tenant-query` | Data access through `withTenant` | F-06 |
| `new-screen` | Building UI against DESIGN.md | F-22 |
| `money` | Paise, tax in basis points, `en-IN` formatting | C-28 |
| `pgboss-job` | Idempotent, tenant-scoped, chunked jobs | C-19 |
| `verify` | The full done-check | S-05 |

### 5.2 The most important one

`.claude/skills/execute-task/SKILL.md`

```markdown
---
name: execute-task
description: >
  Execute a numbered task from implementation-plan.md (IDs like S-01, F-08,
  C-22, V-30). Use whenever the user asks to build, implement, start or
  continue a task by ID, or says "next task". Reads the task's dependencies
  and architecture sections, fetches current library docs, implements, and
  runs the full verification gate before reporting done.
---

# Executing a plan task

## 1. Load context
- Find the task in `implementation-plan.md`
- Confirm every dependency task is complete. If not, STOP and say so.
- Read any architecture section the task names under "Read first"
- Read `DESIGN.md` if the task touches UI

## 2. Check the docs
If the task uses any library in agent-setup.md §4.2, fetch current
documentation before writing code. Do not rely on recall.

## 3. Implement
- Smallest change that satisfies the acceptance criteria
- No adjacent refactoring, no extra features, no "while I'm here"
- Files under 300 lines

## 4. Verify
pnpm typecheck && pnpm lint && pnpm test && pnpm build

Then check the task's specific acceptance criteria by hand.

## 5. Report
State: what changed, which files, how acceptance was verified, and anything
deferred. If any criterion is unmet, say so plainly — do not claim done.

## Never
- Start the next task without being asked
- Add an npm dependency without asking
- Modify a schema from a completed task
- Disable a lint rule or skip a test to make the gate pass
```

### 5.3 A worked example

`.claude/skills/rls-table/SKILL.md`

```markdown
---
name: rls-table
description: >
  Create a new tenant-scoped database table with correct row-level security,
  indexes and audit columns. Use whenever adding any table that holds tenant
  data — members, sessions, invoices, bookings, staff records and so on.
  Do not use for platform-level tables (plans, features, presets), which are
  not tenant-scoped.
---

# Creating a tenant-scoped table

Every such table gets all of the following. No exceptions, no shortcuts.

## Columns
- `id uuid primary key` (UUID v7)
- `tenant_id uuid not null references tenants(id)`
- domain columns
- `created_at`, `updated_at` timestamptz not null default now()
- `created_by`, `updated_by` uuid
- `deleted_at timestamptz` if soft delete applies

## RLS — both statements, always
alter table X enable row level security;
alter table X force row level security;

create policy tenant_isolation on X
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

`force` matters: without it the table owner bypasses the policy entirely.

## Indexes
Every index begins with `tenant_id`. Add `where deleted_at is null` to
indexes on soft-deletable tables.

## After
1. Add the Drizzle schema in `db/schema/<domain>.ts`
2. Generate the migration — never hand-edit an applied one
3. Extend `tests/isolation.test.ts` to cover the new table
4. Confirm `app_user` still cannot bypass the policy

## Never
- A tenant-scoped table without RLS
- An index not starting with tenant_id
- Granting BYPASSRLS to app_user
```

### 5.4 Writing your own

Anthropic's `skill-creator` generates a skill interactively and runs an eval loop over the description to check it actually triggers — worth using rather than hand-writing, because a description that never fires is the most common failure.

```
/plugin install skill-creator@anthropic-agent-skills
```

Guidelines: one procedure per skill; body short with detail in supporting files; describe *when* to use it, not just what it does; test by sending a prompt that should trigger it.

---

## 6. Hooks — mechanical guardrails

Instructions get ignored under pressure. Hooks do not.

`.claude/settings.json`:

```jsonc
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Edit|Write",
        "command": ".claude/hooks/guard.sh" }
    ],
    "PostToolUse": [
      { "matcher": "Edit|Write",
        "command": "pnpm typecheck --silent" }
    ]
  }
}
```

`guard.sh` should block, not warn:

- Edits to migrations under `db/migrations/` that are already applied
- `@/db/client` imported outside `db/` or the platform module
- New hex colour literals in `app/` or `components/`
- Barrel imports from `lucide-react`
- `parseFloat` or `Number(` near anything named amount, price, fee or paise

### Pre-commit

```
lint-staged → eslint --max-warnings=0 → typecheck → related tests
```

### CI is the real gate

Section 5 of the implementation plan lists it: typecheck, lint, test (including `isolation.test.ts`), build, bundlesize at 150 KB. **CI must be able to fail the build.** An agent that can merge past a red pipeline has no guardrails at all.

---

## 7. Bootstrapping order

Day one, in sequence:

1. Create accounts from §2.2, store credentials
2. `git init`, push an empty repo
3. Write root `CLAUDE.md` (§3.2) and symlink `AGENTS.md`
4. Install Context7, verify a doc lookup returns current Next.js content
5. Add the Postgres MCP against local only
6. Author `execute-task` and `verify` skills
7. Add hooks and pre-commit
8. Run task **S-01**
9. After S-02, author `new-screen`. After F-01, author `rls-table` and `drizzle-migration`.

Skills are written **just before the first task that needs them**, not all upfront. A skill authored before you understand the pattern encodes a guess.

---

## 8. What not to give the agent

| Withhold | Why |
|---|---|
| Production database credentials | One bad migration is unrecoverable |
| Live payment keys | Test mode only until a human reviews the flow |
| Real customer data | Use synthetic seeds. Children's data is never a test fixture |
| Ability to force-push or rewrite history | |
| Ability to merge with CI red | The gate must be able to say no |
| Real WhatsApp send credentials in dev | Every test message costs money and can reach a real parent |

---

## 9. Working practice

**One task, one session.** Long sessions drift — the agent starts refactoring things nobody asked about. Finish a task, verify, commit, start fresh.

**Review the schema and money paths yourself.** Everything else can be regenerated. These two cannot. Read every migration and every line touching invoices, payments or payouts as if you wrote it.

**When the agent says done, check the acceptance criterion, not the code.** "Fifty concurrent booking attempts produce exactly one success" is a thing you run, not a thing you read.

**Track deviations.** When you overrule the plan, write down what changed and why. In three weeks nobody will remember, and a plan that silently diverges from the code is worse than no plan.

**Re-read `project-scope.md` §9 before each phase.** It lists what you are deliberately not building. Scope creep into a no-code platform is the single most likely way this project fails, and an eager agent will happily help you do it.
