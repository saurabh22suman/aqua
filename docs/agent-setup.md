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
| Node | 22 LTS | Pinned in `.nvmrc` at the repo root, and in CI (`.github/workflows/ci.yml`, `node-version: 22`) |
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

What actually exists in the repo today:

```
CLAUDE.md                            ← repo root. Always loaded.
AGENTS.md                            ← symlink to CLAUDE.md for non-Claude agents
DESIGN.md                            ← design tokens and rules
docs/architecture.md                 ← referenced, not auto-loaded
docs/implementation-plan.md          ← referenced, not auto-loaded
db/CLAUDE.md                         ← directory-scoped rules
.claude/
  settings.local.json                ← local permissions (not checked in for sharing)
  skills/execute-task/SKILL.md       ← the one project skill authored so far
```

There is no `app/CLAUDE.md` and no checked-in `.claude/settings.json`.

### 3.2 Root CLAUDE.md

See the real `CLAUDE.md` at the repo root — do not duplicate it here, a
copy is guaranteed to drift.

It loads on every request, so keep it tight; but note the real file has
outgrown the "under 100 lines" target, because each absolute rule now
carries an annotation saying whether it is *mechanically checked* or
review-only. That annotation is worth the lines: an agent that assumes
"absolute" means "the test suite will catch it" is the exact failure the
annotations prevent.

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

**`app/CLAUDE.md`** — not yet created. Sketch of what it should contain:

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

### 5.1 Skills

**Only `execute-task` exists today.** Add rows to this table as skills are
actually authored — a table of skills that don't exist sends an agent
looking for files that aren't there.

| Skill | Encodes | Status |
|---|---|---|
| `execute-task` | The plan's task loop, stop levels and verification gate | Authored |

Candidates worth authoring when the pattern they encode is understood
(and not before — see §5.4): `rls-table`, `drizzle-migration`,
`tenant-query`, `new-screen`, `money`, `pgboss-job`, `verify`.

### 5.2 The most important one

`.claude/skills/execute-task/SKILL.md` — read the real file; what follows
is a description of what it does, not a copy to paste.

It executes a numbered task from `docs/implementation-plan.md` (IDs like
S-01, F-08, B-05, C-22, V-45) and covers four things the sketch above
this document's first draft did not:

- **Stop levels.** Every task is GREEN (build, verify, commit, continue
  without asking), AMBER (build, verify, commit, then stop and report —
  new dependencies, schema changes to a completed task's table,
  anything that changes a decision in `architecture.md`) or RED (stop
  *before* building and propose — tenant isolation, auth, money,
  children's data, consent, anything marked FLAGGED DECISION NEEDED).
  A GREEN task that turns out to need a dependency becomes AMBER on
  the spot. When a task spans subjects, the highest tier wins.
- **Proving tests can fail.** A green test alone proves nothing. Where
  a task guards a safety property, the skill requires showing that
  breaking the thing makes the test red — a mutation proof, not a
  passing run.
- **Task-ID-prefixed commits.** One commit per task, message prefixed
  with the ID: `feat(B4): ...`, `docs(V-45): ...`.
- **Batch execution.** Given a range ("run B3 to B8"), it runs
  consecutive tasks and pauses at the first AMBER or RED, reporting
  once at the end of the batch rather than once per task.

The verification gate is `pnpm typecheck && pnpm lint && pnpm test`
plus the task's own named proof; data-layer work adds `pnpm db:migrate`
against a clean database and, when RLS or grants changed, the
`pg_class` and role-flag queries from `docs/review-checklist.md`.

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
3. Extend `tests/tier1/isolation.test.ts` to cover the new table
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

## 6. Hooks — not configured

Instructions get ignored under pressure. Hooks do not — which is why
it matters that **this project has none.** There is no
`.claude/hooks/` directory and no checked-in `.claude/settings.json`
declaring `PreToolUse` or `PostToolUse` commands. Nothing intercepts an
edit before it lands.

In particular: there is **no `guard.sh`**, so there is no hook making
`tests/tier1/**` read-only to the agent, and no hook blocking edits to
applied migrations, stray hex colours, `lucide-react` barrel imports or
float arithmetic near money. Anything claiming otherwise is describing
a design that was never built. Those rules are real, but they are
enforced — where they are enforced at all — by ESLint, by tests under
`tests/tier1/`, and by CI. See the per-rule annotations in the root
`CLAUDE.md`, which say for each absolute rule whether it is checked
mechanically or by review.

A hook layer is still worth building. If it gets built, it should
block, not warn, and this section should be rewritten to describe what
exists rather than what was intended.

### Pre-commit

Also not configured — no `lint-staged` / husky wiring in the repo. The
verification gate is run by hand (`pnpm typecheck && pnpm lint && pnpm
test && pnpm build`) and again by CI.

### CI is the real gate

This part holds, and it is now the load-bearing one. CI runs typecheck,
lint, test (including `tests/tier1/isolation.test.ts`), build and the
bundle budget at 150 KB. **CI must be able to fail the build.** An
agent that can merge past a red pipeline has no guardrails at all.

Since 2026-09-04 that is enforced rather than hoped for: the `main
protection` repository ruleset is active, requires a pull request, and
requires both the `ci` and `agent-protected-paths` status checks to be
green with `bypass_actors: []`. The remaining gap is
`required_approving_review_count: 0` — no human approval is
mechanically required, which is why `CLAUDE.md`'s F1 self-merge
suspension exists as the compensating control. See
`docs/branch-protection.md`.

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
