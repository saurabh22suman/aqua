# The ops platform — configuration layer and sales spine

**Status:** proposal for discussion. Not yet decided.
**Tasks:** extracted to `implementation-plan.md` §"Ops platform spine"
(O-01–O-11), which records the decisions adopted for implementation.
**Companion docs:** `architecture.md` §7 (entitlements), `project-scope.md` §3.1 (platform role), `docs/red-proposals.md` §3.8 (impersonation — still pending).

---

## 1. The premise, and the one correction

The goal is right: one deployment, one schema, per-tenant variation handled by data rather than by forking. The ops console is where that variation is authored, and the owner sees a curated subset. High-touch configuration by an ops team is a genuine advantage in the Indian SMB market, where owners want the thing to work rather than to be configured.

The one correction: **"every aspect should be configurable" is the failure mode, not the goal.**

Every configuration option is a branch. Every boolean doubles the state space the system must be correct across. This project's own transferable lesson is that the application code holds and the *verification layer* is where things break — and an unbounded config surface makes verification impossible by construction, because no test suite can cover a state space that grows exponentially with each toggle an ops engineer adds on a Tuesday.

Microsoft's multitenancy guidance puts the same point directly: avoid deploying features or configuration that apply to only a single tenant, because it adds complexity to deployment and testing; use the same resource types and codebase for every tenant, and use entitlements or progressive flags instead.

So the discipline is not "make everything configurable." It is **"make the right things configurable, make everything else a variant chosen from a fixed set, and make the resolved result inspectable."**

### The admission test

Before any new config key exists, it must pass all four:

1. **Two real clubs would genuinely answer this differently.** Not hypothetically — name them.
2. **The difference changes behaviour or a business rule, not just wording.** Wording belongs in the terminology layer, which is already built.
3. **There is a default that works without anyone setting it.** No tenant may ever be in an unconfigured state.
4. **A wrong value is recoverable.** If a bad value can corrupt money or member data, it is not configuration — it is a code path with a guarded migration.

Anything failing the test is either a preset variant, a code decision, or an entitlement.

---

## 2. Four layers that are routinely conflated

These have different owners, lifecycles, and storage. Mixing them is the most common way control planes rot.

| Layer | Question it answers | Owner | Lifecycle | Example |
|---|---|---|---|---|
| **Entitlement** | Has this tenant paid for it? | Commercial / ops | Changes on plan change; permanent | Reports, café, messaging volume |
| **Release flag** | Is this rollout on for them yet? | Engineering | **Temporary — must be deleted** | New register UI |
| **Configuration** | How does this club actually work? | Ops, some by owner | Long-lived, per tenant | Fee cycle, age bands, occupancy cap |
| **Content** | What does it look like and say? | Owner | Owner-edited freely | Branding, terminology, templates |

Two consequences worth stating plainly.

**Entitlements are not feature flags.** A flag is a temporary engineering device that should be deleted after rollout. An entitlement is a commercial fact that lives as long as the account. Storing them in one table means dead flags accumulate forever and nobody dares delete any of them. Keep separate tables, and give release flags a mandatory expiry date that CI warns on.

**Content is already solved.** Branding and terminology ship and work. Do not let business rules leak into that layer because it happens to be editable.

### Mapping to what already exists

This is a unification, not a rewrite. Today's pieces already occupy the layers:

- `features` + `plan_features` + per-tenant toggles → **entitlement layer** (exists)
- presets and `preset-definitions.ts` → **configuration templates** (exists)
- branding, terminology, accent token → **content layer** (exists)
- `platform_audit_log` and `/ops/activity` → **audit spine** (exists)

What is missing is the middle: a first-class configuration registry, a resolver, and provenance.

---

## 3. The configuration registry

One registry. Not one for ops and another for owners — that guarantees drift.

```
config_keys                       -- the catalogue (platform-owned, seeded, versioned in code)
  key                text pk      -- 'billing.cycle', 'pricing.age_bands', 'pool.occupancy_cap'
  value_schema       jsonb        -- Zod-compatible shape; validated on every write
  default_value      jsonb        -- must always produce a working system
  visibility         enum         -- owner_edit | owner_read | ops_only
  risk               enum         -- safe | sensitive | dangerous
  description        text         -- shown verbatim in both consoles

config_values                     -- append-only; never updated in place
  id                 uuid pk
  key                text fk
  scope_type         enum         -- platform | plan | preset | tenant | location
  scope_id           uuid null
  value              jsonb
  set_by             uuid         -- platform user or tenant user
  set_at             timestamptz
  reason             text null    -- required when risk = dangerous
  superseded_at      timestamptz null
```

Append-only matters. It gives free history, diffs, and revert, and it matches the soft-delete convention already used everywhere else.

### Resolution order

```
platform default → plan → preset → tenant override → location override
```

Deterministic, single function, no exceptions. The resolver returns not just the value but where it came from:

```ts
resolve('billing.cycle', ctx)
// { value: 'monthly', source: 'preset:swimming-club', setBy: 'ops:priya', setAt: '2026-08-14' }
```

**Provenance is the highest-value feature in the whole ops layer, and it is nearly free if built into the resolver on day one.** Retrofitting it later means auditing every call site. The support question is almost never "what is the value" — it is "why is it that, and who did it."

### The preset blast-radius decision — decide before building

If ops edits the `swimming-club` preset, do forty existing clubs change tonight?

- **Copy-on-apply:** the preset writes tenant-scoped rows once. Editing the preset affects only future applications. Safe, predictable, no live coupling. Costs a migration tool to push an updated preset to existing tenants deliberately.
- **Live inheritance:** tenants read through to the preset unless overridden. One edit fixes everyone. Also means one edit breaks everyone.

**Recommendation: copy-on-apply**, with an explicit, previewed, per-tenant "re-apply preset" action. This is a one-person team with agent-written code; a live-inheritance edit is an unreviewed change to every customer at once.

---

## 4. Who sees what

Four tiers, expressed as the `visibility` column, not as two separate consoles.

**Owner-editable.** Outcomes, not mechanisms. Branding, terminology, holidays, absence-alert thresholds, the hourly rate card, batch names and timings. The rule of thumb: the owner sets *what their club does*, never *how the software achieves it*.

**Owner-readable, ops-editable.** Shown greyed out with the current value and a **Request change** button. This is more useful than hiding: it kills the "can I even do this?" support call, it generates a ticket with the tenant and key pre-filled, and the pattern of requests tells you which keys should graduate to owner-editable.

**Ops-only.** Entitlements, limits and quotas, messaging budgets, anything touching money semantics, anything touching consent or retention.

**Nobody.** Tenant isolation, the scope model, permission enforcement, audit writes. These are invariants. The bar to remember: *placement is configuration; isolation remains invariant.*

---

## 5. The audited mutation pipeline

Every ops write goes through one wrapper. No exceptions, no direct database writes, no "just this once" script.

```ts
opsAction({
  scope: 'tenant.config.set',       // typed, from a closed union
  tenantId, targetKey,
  reason: 'Ticket #412 — club charges per hour, not monthly',
}, async () => { ... });
```

The wrapper asserts the platform permission, writes the audit row in the same transaction as the mutation, and records actor, scope, tenant, target, before, after, and reason. Reason is mandatory for `dangerous` keys.

This is where the project's own lesson applies hardest. `docs/status-report` records six live `TODO(tenant-audit-log)` call sites with **zero mechanical test coverage** — a documented rule that has already decayed. So the pipeline is not done when the wrapper exists. It is done when a CI scan fails on any exported platform action that mutates without going through it, and that scan has a known-bad fixture it must flag.

### Bulk actions

Anything touching more than one tenant needs, in order: dry-run showing the exact diff per tenant, idempotency, a blast-radius confirmation above a threshold, and a recorded rollback path. Preset apply already has a preview — generalise that pattern rather than inventing a second one.

---

## 6. Support access without impersonation

Impersonation is listed as a pending RED item and is currently blocking Phase 3. It should stay blocked for now, because there is a cheaper thing that solves most of the need.

**Most support cases are configuration questions, not data questions.** "Why can't my coach see Reports?" is answered by the resolved config and the permission matrix, not by looking at anyone's members.

So build the **effective-configuration viewer** first: for a given tenant and role, ops sees every resolved config value with provenance, the entitlement set, the permission matrix, and the nav that role would render — **with no member PII on the screen at all**. This resolves the majority of tickets, needs no RED decision, and creates no DPDP exposure.

When impersonation is eventually built, the accepted shape from current practice is: time-boxed, justified with a written reason, visible to the impersonated user with a persistent banner, narrow in scope, comprehensively audited, and **read-only by default** — never standing cross-tenant access. For this product, add two constraints the general guidance does not cover:

- **Never impersonate into the parent surface.** Those links carry a child's attendance and medical context to a specific family.
- **A write-capable impersonation session must be a separate, rarer grant** than read-only, with the tenant owner notified after the fact.

The DPDP framing matters commercially too: as a data processor, every impersonated view of a child's date of birth or medical note is a processing event that needs a lawful basis and a record. Read-only-with-reason is defensible; ambient access is not.

---

## 7. Sales queries in the ops console

Sales leads and member enquiries look similar and must not share a table.

| | Member enquiry | Sales lead |
|---|---|---|
| Who | A parent → a club | A club → the platform |
| Scope | Tenant-scoped, under RLS | **Platform-scoped, no tenant_id yet** |
| Lives in | `enquiries` (built) | new `platform_leads` |
| Ends in | A member | A tenant |

That second row is a standing risk. Platform-scoped tables sit outside RLS, the same category as `users`, where safety is discipline with no mechanical backstop. `platform_leads` will hold names and phone numbers of real people. Give it the same treatment as `users`: an explicit allowlist entry, and a source scan restricting which files may import it.

### Lifecycle, and why it is the onboarding fix

```
lead → qualified → demo booked → trial tenant provisioned → converted → active
                                        ↓
                                   lapsed / lost (with reason)
```

The important design move: **a lead converts into a tenant, carrying its qualification answers forward as that tenant's initial configuration.**

The sales conversation already asks everything onboarding needs — which sport, how many members, monthly fees or per-hour or both, cash or UPI, GST registered, how many coaches, one location or several. Today those answers live in someone's head or a WhatsApp thread and are re-entered during setup. Captured as structured fields on the lead, they select the preset and seed the config rows at provisioning time.

This matters beyond tidiness. `project-scope.md`'s own risk table rates onboarding friction as high likelihood and high impact, with the CSV importer as the named mitigation — and the importer does not exist. Lead-carried configuration plus the member self-registration link together do more for onboarding friction than the importer would, and are cheaper to build.

### Intake channels

Website form, phone, and WhatsApp. WhatsApp inbound is nearly free once the messaging layer exists, since service messages inside the 24-hour window are the cheap category, and it is where Indian academy owners already are. One caution: from 1 October 2026 Meta begins charging for service and utility messages inside that window, so meter lead conversations from the start rather than assuming they are free.

### Trial mechanics

Tenant status already has `trial`. Add to the lead record: trial start, trial expiry, the ops owner of the account, and a conversion decision with a reason. Lost-reason data is the only honest input to the pricing question, which is still undecided.

---

## 8. Tenant hierarchy

### The skeleton is fixed; the body varies

Four levels, the same four for every tenant, always:

```
tenant      the business. one owner, one consolidated view, the RLS boundary
└── location    a physical site. address, hours, staff, its own rate card
    └── facility    a bookable resource at that site: pool, court, café counter
        └── sub-unit    lanes, courts, tables — the sub_units jsonb in architecture §8.7
```

What varies per tenant is how many nodes exist, what `kind` each facility is, which preset applies where, and which config values are set at each level. All of that is data. None of it is structure.

Two real shapes, to show the skeleton does not bend:

```
A — café alongside the pool          B — badminton and café in different places
tenant: Sharma Sports                 tenant: Mehta Ventures
└── location: Worli                   ├── location: Andheri
    ├── facility: pool   → lanes      │   └── facility: badminton → courts
    └── facility: café   → counter    └── location: Bandra
                                          └── facility: café      → counter
```

Same tables, same four levels, different rows. Whether the café sits next to the pool or across town is answered by which location row it points at, not by a setting.

### Why not a generic tree

An "org unit" tree where tenants define their own levels looks like maximum flexibility and is how this class of product dies. Permissions become recursive tree-walks, every report needs a per-tenant aggregation strategy, and no test means anything because no two tenants have the same shape. It is §1's admission test failing in a new costume: the difference between two clubs is *how many* nodes, never *what kinds of node exist*.

### The rule that makes both views free

**Members belong to the tenant. Everything that happens carries a location.**

A member enrols once at the business level, so someone can join a programme at Worli and another at Andheri without being duplicated and without a "home branch" — which is a trap, because owners then ask to transfer members between branches and there are two sources of truth.

Every event row — session, attendance mark, hourly entry, café sale, payment — carries `location_id`. The consolidated view is that query with no location filter; the per-site view is the same query filtered. Neither is a special case, and neither needs a cross-tenant read.

That last point is the reason for this whole model. If each club were its own tenant, the owner's consolidated view would require reading across tenants, which means either weakening RLS or running the dashboard under `withPlatform()`. Both would undo the one property that has held under every adversarial round so far. **The tenant is the business, not the club.**

### Schema sketch

```
locations
  id, tenant_id, legal_entity_id (nullable — see below)
  name, kind            -- 'club' | 'cafe' | 'mixed'
  address, timezone, opening_hours
  is_primary            -- the auto-created one; drives single-site UI suppression

facilities
  id, tenant_id, location_id
  name, kind            -- 'pool' | 'court' | 'counter' | ...
  capacity
  sub_units  jsonb      -- lanes/courts as real entities (architecture §8.7)

staff_locations         -- staff are many-to-many with locations
  staff_id, location_id, is_primary
```

`facilities` today is a flat preset-seed shape with no `sub_units` and no location link. This is the migration that gives it both.

### Single-site owners must never see the concept

When a tenant has exactly one location, the word never appears: no location switcher, no "Locations" in settings, no location column anywhere. The primary location is created automatically at provisioning and every screen implies it.

Adding a second location is what makes the concept visible. That is also the natural boundary for a higher price tier.

The point of doing this now rather than later is that there is no "simple mode" to migrate out of. The reference club runs on the same schema as a three-site operator from day one.

### Presets must apply per location, not per tenant

This is the concrete engine change. Today a preset is applied to the whole tenant, which means **a business with a pool and a café cannot be configured correctly at all** — one preset cannot describe both.

Required: a preset is applied to a location, `location.kind` constrains which presets are offered, and a tenant may hold several different presets across its locations. Everything in §3 still holds — copy-on-apply, previewed, deliberate re-apply — the scope simply moves down one level.

This should land before more tenants are provisioned onto presets, because retro-fitting location scope to already-applied presets means reconstructing which values came from where, which is exactly the provenance problem §3 exists to prevent.

### Location-scoped staff access

Some owners want the Andheri receptionist blind to Worli's members. Others run one pooled team and would find that infuriating. So this is a real config key, at tenant scope, defaulting to **off** — meaning today's tenant-wide behaviour, unchanged.

When on, two things are non-negotiable:

1. **Enforce in the service layer, with a CI scan.** RLS is tenant-level and cannot help here. Filtering `listMembersAction` by location while leaving `getMemberDetailAction` reachable by ID is the "scoping the list, not the direct path" failure class already named in `docs/review-checklist.md`. A scan must fail on any location-scoped read that skips the filter, with a known-bad fixture it is required to flag.
2. **Document it as an access-control boundary, not an isolation boundary.** One business, one controller, one tenant. A leak across locations is an internal permissions bug; a leak across tenants is a breach. Keep the two words distinct in every doc and test name, or the distinction will blur and someone will treat location scoping as though RLS were behind it.

### Staff across locations

Staff become many-to-many with locations, which the current schema does not express. Three consequences:

- A coach's Today screen spans sites and must show which site each session is at.
- Coach-conflict detection changes meaning. A clash within one site is a double-booking; a clash across sites may be physically impossible. Even a crude per-pair travel-time buffer is worth modelling.
- Pay rates may differ per location, which matters when staff pay lands.

The existing invite path also creates staff rows only for coach and receptionist, so admin, worker and accountant cannot be attached to a location at all. That gap should close with this work, not after it.

### Open question: legal entities and GST

If a tenant's sites are separate legal entities — especially across states, with separate GSTINs — then invoice numbering cannot be gapless per tenant. It must be gapless **per GSTIN**, and C-31 currently specifies per tenant.

The clean shape is a `legal_entity` record carrying GSTIN, legal name and bank details, with locations pointing at one. One tenant, consolidated view intact, invoicing scoped correctly. Whether to build it now depends on whether any pilot tenant is actually multi-entity; the nullable `legal_entity_id` above keeps the door open at near-zero cost.

**This must be settled before invoices exist.** Renumbering issued invoices after the fact is a compliance problem, not a refactor.

### Fixed versus variable, in one table

| | Fixed for everyone | Varies per tenant |
|---|---|---|
| Levels in the hierarchy | ✓ four, always | |
| Number of locations and facilities | | ✓ data |
| Facility `kind` | ✓ closed set | ✓ which one, per row |
| Preset | | ✓ per location |
| Rate card | | ✓ per location |
| Café charges to member account | | ✓ config key, location scope |
| Location-scoped staff access | | ✓ config key, tenant scope |
| Members belong to the tenant | ✓ invariant | |
| Every event carries a location | ✓ invariant | |
| Tenant is the RLS boundary | ✓ invariant | |

---

## 9. Messaging channel

WhatsApp is the primary channel for credential delivery, fee reminders, absence alerts, receipts and parent links. SMS is not a fallback worth building: commercial SMS in India requires DLT registration, which is paperwork outside our control, and WhatsApp authentication messages cost a fraction of SMS in this market.

### Decision: one WhatsApp number per tenant, owned by the tenant

Not a single shared platform number. Four reasons, any one of which would settle it:

1. **Quality rating and messaging limits are per phone number.** Meta tracks quality state per WABA and notifies the partner when it changes. On a shared number, one club sending badly received messages degrades delivery for every other club. On separate numbers, the damage is contained to the tenant that caused it.
2. **Inbound replies must reach the club.** A parent will answer a fee reminder. On a shared number that lands with the platform, which means operating a support desk for other people's members.
3. **Display name is per number.** In a tenant-branded product, messages must come from the club's name, not ours.
4. **Data-protection posture.** If the club owns the WABA, the club is the controller of those conversations and the platform remains the processor — the same relationship we already have for member data. Owning the number would make us the controller of conversations with children's guardians, a worse and harder-to-explain position.

### Mechanism

Meta's Embedded Signup in the **Tech Provider** flow: the customer creates a WABA and claims a number without leaving our product, and the backend receives their WABA ID and business phone number ID. The app must then subscribe to webhooks on each customer's WABA individually — this is per-WABA, not a one-time setup.

**Build on Embedded Signup v4. Version 2 is deprecated on 15 October 2026.**

### No BSP at pilot scale

Meta charges nothing for platform access; the cost is per delivered message. Indian BSPs are built for a single business managing its own number and add a monthly subscription on top of Meta's rates — at pilot scale that would exceed our own subscription revenue per tenant. Revisit only if per-WABA operational load becomes the bottleneck.

Caution when evaluating vendors: many BSP pricing pages still quote *per-conversation* rates. Meta moved to per-message billing in July 2025, so those figures do not match a real bill.

### Who pays

Under the Tech Provider flow, onboarded business customers add their own payment method to their WhatsApp Business account, so **the tenant is billed by Meta directly** and messaging never appears on our P&L.

This is a stronger commercial position than bundling. The offer becomes: a flat monthly fee, zero commission on payment volume, and messaging billed at cost by Meta — roughly ₹0.115 per utility or authentication message plus GST. A club sending 2,000 messages a month pays Meta about ₹270. Nothing is marked up, which is the same argument being made against competitors who take a percentage of collections.

### Metering still matters

Two reasons, even though we are not paying:

- Marketing templates cost roughly 7.5× utility templates. A tenant blasting promotions is spending their own money, but on our rails and against their own quality rating.
- From **1 October 2026** Meta charges for service and utility messages sent inside the previously free 24-hour customer-service window. Build the message log and meter assuming every message costs something; do not design around a free window that is closing.

### Onboarding prerequisites — the real risk

The architecture is straightforward; getting a club through Meta's requirements is not. Each tenant needs:

- a Facebook Business Manager and completed business verification, with documents
- **a phone number not currently attached to a personal WhatsApp account** — numbers on the WhatsApp Business app can be onboarded but require a customised flow
- template approval, which typically adds several days
- acceptance that a new number starts with low messaging limits that rise with usage

The phone-number constraint bites hardest, because most club owners' business number is already their WhatsApp. **Standard advice: a dedicated SIM for the club.** Cleaner than migrating the number the owner uses all day.

This is where high-touch ops onboarding stops being a slogan and becomes the product. Walking an owner through business verification on a call is a service self-serve competitors do not offer, and it belongs in the onboarding checklist rather than being discovered on go-live day.

### Template synchronisation

Templates are defined centrally in code, then pushed to each tenant's WABA through the API, with approval status tracked per tenant. This is the most commonly underestimated piece: **every tenant needs its own approved copy of every template**, and a template that is approved for one tenant is not approved for another. A tenant whose templates are not yet approved must degrade gracefully rather than fail silently.

### Fallback is mandatory

If WhatsApp is not yet onboarded for a tenant, or a send fails, the owner must be able to see the link or message on screen and deliver it themselves. Credential delivery must never depend solely on a channel we do not control. The magic-link-on-screen path already in place is that fallback and should not be removed when WhatsApp ships.

### Config layer mapping

A useful test of §2's taxonomy:

- WABA ID, phone number ID, access token → **ops-only configuration, `dangerous` risk.** These are long-lived third-party credentials. Encrypted at rest, with an import restriction on the module that reads them, the same treatment given to `users` and `platform_leads`.
- Template body and wording → **content layer**, owner-editable within an approved shape.
- Monthly message budget, and whether marketing templates are permitted at all → **entitlement**.

### Open questions

- Is each pilot tenant a registered business with the documents Meta requires for verification? If not, WhatsApp onboarding stalls and the fallback carries the pilot longer than planned.
- Does a tenant with multiple locations (§8) want one number for the business or one per site? One per business is the default; per-site would mean a WABA per location and multiplies the onboarding burden.

---

## 10. Build order

The full vision is large and money is still unbuilt. This is the thin spine, ordered so each step is useful alone.

0. **Hierarchy migration (§8).** `locations` gains `kind` and `is_primary`; `facilities` gains `location_id` and `sub_units`; `staff_locations` is added; every tenant gets an auto-created primary location and every existing event row is backfilled to it. Presets move to location scope in the same pass. This is first because every level below resolves against it, and because retro-fitting location scope to already-applied presets means reconstructing provenance that was never recorded.
1. **Config registry + resolver with provenance.** Small, foundational, and expensive to retrofit. Migrate the existing preset and toggle values into it rather than adding a parallel system.
2. **Audited mutation wrapper + CI scan with a known-bad fixture.** Closes the `TODO(tenant-audit-log)` class mechanically instead of by convention.
3. **Effective-configuration viewer in `/ops`.** Support capability with no PII exposure and no RED decision needed.
4. **Owner settings rendered from the same registry**, filtered by `visibility`, with the Request-change path.
5. **`platform_leads` + lead→tenant conversion carrying config.**
6. **Messaging: provider abstraction + manual WABA onboarding for the first tenants.** Store WABA ID, phone number ID and token as ops-only config; onboard the first few tenants by hand. Embedded Signup v4 in `/ops` is worth building at roughly five tenants, not before — but template synchronisation and the metered message log are needed from the first tenant.
6. *Later:* impersonation (RED), bulk operations, deeper per-key config as real demand appears.

Steps 1–4 are the platform. Step 5 is the business. Everything after is demand-driven, and the admission test in §1 is what keeps it from sprawling.

---

## 11. Risks to hold in view

- **Config explosion defeats verification.** The registry makes adding keys easy, which is exactly the danger. The admission test is the control, and it needs an owner willing to say no.
- **Untested config combinations are untested code paths.** At minimum, test the default set and each shipped preset end to end. Arbitrary combinations cannot be tested, which is itself an argument for presets over free-form toggles.
- **Platform-scoped tables have no RLS.** `platform_leads` joins `users` in the category where discipline is the only backstop.
- **Ops power has no second pair of eyes.** A solo operator plus agents means the audit trail is the only control. That makes the §5 scan load-bearing rather than nice to have.
- **Preset edits are a fleet-wide change.** Whichever model is chosen in §3, it must be a deliberate, previewed action — never a side effect of editing a definition file.
- **Per-tenant third-party credentials are a new class of secret.** WhatsApp tokens are long-lived credentials to an external system, held per tenant. A leak is not a data-exposure incident but an impersonation one: someone could message a club's parents as the club. Encryption at rest and a restricted import path are the minimum, and rotation needs a defined procedure before the first tenant is onboarded, not after.
- **External dependencies have deadlines we do not set.** Embedded Signup v2 retires 15 October 2026 and the free 24-hour messaging window closes 1 October 2026. Platform vendors will keep doing this; anything built against a third-party API needs an owner who tracks its changelog.
