# Mock gate access — the backend contract

**Status:** mock-only backend, no public endpoint, no UI.
**Scope:** `lib/services/mock-access/**`, `db/schema/mock-access.ts`,
`db/migrations/20261025234623_mock_gate_access.sql`, `tests/mock-access/**`.

This is the backend a gate needs before any door has hardware in it: the
gates an academy owns, the cards and PINs its members hold, the decision
a presented credential gets, the log that decision is written to, and the
staff override that can let somebody in when the policy says no.

**What this is not.** There is no endpoint, no route, no page and no
device integration. Nothing here is reachable from the browser or from a
gate; the services are called by whoever wires them (see the integration
requests in `docs/handoffs/mock-access.md`). There is no hardware
protocol, no vendor reader, no paid provider. There is no staff-PIN
shortcut, by construction rather than by policy.

---

## 1. The model

Three tenant-scoped tables.

### `gate_devices` — the gates

| Column | Meaning |
| --- | --- |
| `device_key` | The gate's name inside the academy: `main`, `court1`, `court2`. Unique per tenant. |
| `location_id` | Where the gate stands. |
| `facility_id` | The facility the gate opens. **Null = the premises gate.** |
| `sub_unit_id` | The court inside that facility. **Null = any court in the facility.** |
| `accepts_pin` / `accepts_rfid` | Which credential methods the gate reads. At least one. |
| `status` | `active` / `disabled`. A disabled gate refuses everything, with a reason. |

The `facility_id` / `sub_unit_id` binding is the whole point of the
model. A gate with no facility stands for the premises and opens for a
booking or a membership anywhere at that location. A gate bound to a
facility opens for **that facility only**. A gate bound to a court opens
for **that court only**.

### `gate_credentials` — the member's card or PIN

| Column | Meaning |
| --- | --- |
| `member_id` | A **member**, never a user. There is no row shape for a staff credential. |
| `kind` | `pin` or `rfid`. |
| `secret_hash` | A keyed HMAC-SHA256 digest. **Never the secret.** |
| `status` | `active` / `revoked`. A revoked credential stays in the log's history. |

### `gate_access_events` — the scan log

One row per device event. Unique on `(tenant_id, device_id,
client_event_id)`, which is what makes the log idempotent.

| Column | Meaning |
| --- | --- |
| `method` | `pin`, `rfid` or `override`. |
| `decision` | `granted` / `denied`. A CHECK constraint ties it to the reason code. |
| `reason_code` | One of the closed set in §3. |
| `basis` | `booking`, `membership` or `override` — which policy opened the gate. |
| `credential_fingerprint` | The digest of the presented secret. Never the secret. |
| `override_reason` / `decided_by` | Set only for a staff override. A CHECK constraint makes the pair inseparable. |

---

## 2. The policy

The policy is pure (`lib/services/mock-access/policy.ts`): given the
facts, it decides. The database work that gathers the facts lives in
`facts.ts`; the flow lives in `gate.ts`.

**A gate opens when — and only when — one of these is true:**

1. **A booking covers the gate right now.** The booking is at the gate's
   location, for the gate's facility (or the gate's court), and the
   current instant is inside `starts_at … ends_at`.
2. **An applicable membership covers the gate today.** The membership is
   at the gate's location, and:
   - at the **premises gate**: any membership at that location;
   - at a **court gate**: only a membership whose `activity_id` names
     that facility.

**A membership applies** only while it is `active` and while today is
inside its window (`starts_on` and `ends_on` are both inclusive, the
same convention C-30 uses for subscriptions). A paused or expired
membership never opens a gate.

**Rules that are deliberate, and why:**

- *No access buffer.* A booking that ended is over. Inventing "ten
  minutes either side" hands out access nobody booked.
- *A general membership does not open a court.* `activity_id = null`
  means "this member's membership covers the premises". If it also
  opened every court, every member would have every court.
- *One member, one court.* A booking for Court 1 does not open Court 2,
  and a Court 2 gate refuses the same member with the reason "your
  booking is for a different court".
- *A booking of the whole facility covers its courts.* A booking that
  names no court booked the facility, so it opens any court in it. (A
  booking that names Court 1 still opens only Court 1.)
- *A retired court does not open.* If the facility or the court a gate
  is bound to is soft-deleted, the gate is refused as switched off.
- *The server's clock decides.* A device's own clock is never trusted.
  Membership days are the tenant's local day (Asia/Kolkata by default).
- *The member must be active or a trial.* `paused`, `lapsed` and `left`
  do not enter.
- *A held booking opens.* `held` is a provisional but reserved slot;
  `cancelled` and `completed` bookings never open a gate.

**When nothing opens the gate, the denial always names a reason** — see
§3. "Missing policy denies explicitly" means a member with no booking
and no membership is told so, in words, not left with a silent click.

---

## 3. The reason codes

The closed set, mirrored by a CHECK constraint on
`gate_access_events.reason_code`.

| Code | Door says |
| --- | --- |
| `granted_booking` | Access granted — a booking covers this gate now. |
| `granted_membership` | Access granted — an active membership covers this gate. |
| `granted_manual_override` | Access granted by a staff override. |
| `denied_device_disabled` | This gate is switched off. |
| `denied_method_not_accepted` | This gate does not accept that method. |
| `denied_unknown_device` | This gate is not registered here. |
| `denied_unknown_credential` | We do not recognise that card or PIN. |
| `denied_credential_revoked` | That card or PIN has been cancelled. |
| `denied_member_inactive` | This membership is not active. |
| `denied_no_active_booking` | There is no booking running at this gate now. |
| `denied_not_booked_here` | Your booking is for a different court. |
| `denied_membership_paused` | This membership is paused. |
| `denied_membership_expired` | This membership has expired. |
| `denied_membership_not_applicable` | This membership does not cover this court. |
| `denied_no_membership` | There is no membership or booking for this gate. |
| `denied_event_conflict` | This access event was already recorded with a different credential. |

`isGrantReason(code)` is the single answer to "was this a grant?", and
the database refuses a row whose `decision` and `reason_code` disagree.

**Two answers, not one.** The reason a device is told and the reason
the log keeps are not always the same code:

| Situation | The door is told | The access log keeps |
| --- | --- | --- |
| A card that was cancelled | `denied_unknown_credential` | `denied_credential_revoked` |
| Everything else | the code itself | the same code |

A cancelled card and an unknown card answer alike. Telling a stranger
that a tag once existed in this academy is an enumeration oracle — it
confirms the tag is one of ours, which is exactly what someone
sweeping tags is looking for, and it buys the person at the door
nothing they could not get from the desk. The staff log keeps the
precise reason, and a device is never handed the member a cancelled
card belonged to.

**The residual, stated plainly.** The door still tells the holder of a
*valid* card why it did not open ("your membership has expired", "your
booking is for a different court"). Those messages are entitlement
information, and the human requirement is explicit denials — but they
also confirm to a tag-sweeper that the tag is real. Collapsing every
denial into one opaque message would remove that oracle and the
explanation with it; the trade-off is an open decision for the human
(§9).

---

## 4. Idempotency, replay and conflict

The device sends a `client_event_id` with every event.

- **The same event id, the same credential** → the event is already
  logged, so **nothing is written**; the caller gets the event back.
  The decision itself is taken on the facts of *this* moment, not on
  the decision that was stored earlier — so a replay can never outlive
  the booking or membership that opened the gate.
- **The same event id, a different credential** → `denied_event_conflict`.
  The stored decision stands and is not modified. An attacker cannot
  reuse a known event id to get a second, different outcome out of it.
  This holds whichever writer wins the race: the writer that loses the
  insert compares the credential fingerprint against the winner's row
  and refuses, exactly as the writer that arrives second does.
- **Two writers, one event id** → the unique index settles it; the
  loser reads back the winner's row and applies the same two rules.

The credential fingerprint (a keyed digest, never the secret) is what
lets the service tell "the same event" from "a different credential
under the same event id".

**Two decisions are not recorded, by design.** A presentation at a gate
this academy does not own (`denied_unknown_device`) has no gate row to
attach an event to, and a conflicting replay (`denied_event_conflict`)
is an event id that is already taken. Both are answered to the caller;
neither is written to the log. The access log is therefore the record
of *decisions at a gate*, not of protocol errors.

The log is append-only at the database level: the application role may
insert and read `gate_access_events`, and may not update or delete a
row (the same posture as `activity_events` and `audit_log`).

---

## 5. The manual override

A member is at the door and the policy says no. An authorised staff
member (owner / administrator — `settings.manage`, which the desk roles
do not carry) can let them in, but never silently:

- the override needs a written **reason** (3–500 characters);
- it is attributed to the staff member who made it (`decided_by`);
- it is written to `gate_access_events` **and** to `audit_log`, in the
  **same transaction**, so an override that cannot be audited does not
  happen;
- the database refuses an override row without a reason, or without an
  actor.

---

## 6. Security — the threat model

| Threat | What stops it | Where it is proven |
| --- | --- | --- |
| A stolen PIN or tag read out of the database | Only a keyed HMAC digest is stored. The digest is per-tenant, so a dump of one academy reveals nothing about another and a guess cannot be correlated across academies. | `gate-credentials.test.ts` |
| A routine rotation of the platform's auth secret breaking every issued card | The credential digest is keyed by a **dedicated** gate secret, so the auth secret is not in the derivation at all. | `gate-secret.test.ts` |
| A deployment that lost its gate secret silently denying every member | A missing or weak secret throws (`GateSecretError`) instead of degrading into "unknown credential". | `gate-secret.test.ts` |
| A staff login PIN used at the gate | A credential belongs to a **member** (`members(id, tenant_id)` foreign key). There is no row shape for a staff credential, so a staff PIN cannot be issued as one. | `gate-credentials.test.ts` |
| One member's card opening every court | The gate's facility / court binding; a court gate needs a facility-scoped membership or a booking for that court. | `gate-policy.test.ts`, `gate-scan.test.ts` |
| A replayed event granting a second entry | The log is unique on `(tenant, device, client event id)`; a replay returns the stored decision and writes nothing. | `gate-scan.test.ts` |
| A reused event id used to re-decide an event | A replay with a different credential is refused as `denied_event_conflict` and the stored row is untouched. | `gate-scan.test.ts` |
| Another academy's card or gate used here | Every read runs inside `withTenant()`; the tables carry RLS enabled and forced with the standard nullif policy. Another tenant's gate key is not this tenant's gate. | `gate-scan.test.ts`, `tests/tier1/isolation.test.ts` |
| A member who left, lapsed or was paused walking in | The member's status is part of the decision; only `active` and `trial` enter. | `gate-scan.test.ts` |
| A booking being used after it ended | The booking window is compared to the server clock, with no buffer. | `gate-policy.test.ts`, `gate-scan.test.ts` |
| A replay outliving the entitlement that opened the gate | A replay is decided on the facts of this moment, not on the stored decision. | `gate-scan.test.ts` |
| An event id hijacked by another credential, whoever wins the race | Both the sequential and the losing-writer path compare the credential fingerprint and refuse with `denied_event_conflict`. | `gate-scan.test.ts` |
| A membership used after it ran out | The membership window is compared to the tenant's local day, on both ends, inclusive. | `gate-policy.test.ts`, `gate-scan.test.ts` |
| An override with no reason, or no author | CHECK constraints on the table plus a mandatory audit row in the same transaction. | `gate-override.test.ts` |
| A raw secret leaking into a log or the audit trail | Only the digest is ever written; the audit payload carries member, gate and reason, never a secret. | `gate-credentials.test.ts` |
| A tag-sweeper learning which tags exist here | A cancelled card and an unknown card answer alike at the door, and the door is never handed the member a cancelled card belonged to. The log keeps the precise reason for staff. | `gate-scan.test.ts` |
| A cancelled card falling back to an older card issued under the previous key | The credential lookup returns on the first match, and the current key is tried first — a cancelled card is cancelled, not shadowed by an older one. | `gate-secret.test.ts` |
| A revocation that lands while a scan is in flight | A revocation is seen by the next scan; the one in flight may still grant. The window is the transaction, not the policy. | stated here, not testable without a timing harness |

**Deliberately not solved here** (see §8): there is no per-gate
rate limiting or lockout, so a captured credential works until it is
revoked; and there is no device authentication, because there is no
endpoint yet.

---

## 7. The mock boundary

The hardware seam is `lib/services/mock-access/reader.ts`:

```ts
export interface GateReader {
  read(): Promise<GateReading | null>;
}
```

`MockGateReader` replays a scripted sequence of readings; a real reader
would implement the same interface and the decision service would not
change. `evaluateGateReading()` is the entry point that takes what a
reader produced; `evaluateGateScan()` takes the method and value
directly.

The credential **verification** seam is
`lib/services/mock-access/verification.ts`: a presented secret in, a
credential (and therefore a member) or an explicit failure out. It is
the only place a raw secret is looked up, and it compares digests, not
secrets.

---

## 8. Provisioning the gate secret

The credential digest is keyed by a **dedicated** secret, not by the
platform's auth secret:

| Variable | Purpose |
| --- | --- |
| `AQUA_GATE_SECRET` | **Required.** Issues and verifies credential digests. At least 32 characters, no whitespace, not one repeated character (the full rule is below). |
| `AQUA_GATE_SECRET_PREVIOUS` | Optional. Verifies only. Holds the key a rotation is moving away from. Same rules. |

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Why dedicated.** Rotating `BETTER_AUTH_SECRET` is a routine operation.
When the credential digests rode on it, that rotation silently
invalidated every card a club had issued — the door would report
"unknown credential" for every member, which looks like lost data
rather than a key change. The digest now depends only on the gate
secret, so the platform's auth secret can rotate freely.

**Fail closed.** A missing or weak secret throws at the crypto
boundary (`GateSecretError`). It never falls back to a derived key and
never degrades into "unknown credential": a deployment that has lost its
secret must fail loudly, because the alternative looks exactly like a
fleet of invalid cards.

**The validation is strict, and the key is never normalised.** The value
is the key material, **verbatim**. It is never trimmed, never padded
and never rewritten, because silently changing the bytes would silently
change every credential digest. A value that *would* need normalising
is therefore **refused**, loudly, and the operator fixes it on purpose:

| Rule | Why |
| --- | --- |
| present and not empty | no key, no digests |
| at least **32** characters, counted on the raw value | padding cannot buy length — 31 spaces and one real character is 32 characters long and no key at all |
| **no whitespace anywhere** | a padded value is a copy-and-paste accident, and the padding is length without material |
| **not one repeated character** | length without entropy |

The same rules apply to `AQUA_GATE_SECRET_PREVIOUS`: a weak previous
key would weaken every verification that falls back to it.

A value that used to be accepted and is refused now (a padded one, for
instance) fails **loudly**, and that is the intent: the alternative —
trimming it — would change every digest without saying so.

**Rotation.** Two keys, one slot:

1. Set `AQUA_GATE_SECRET_PREVIOUS` to the current `AQUA_GATE_SECRET`.
2. Set `AQUA_GATE_SECRET` to the new key.

Cards issued under the old key keep verifying — the previous key is
tried after the current one — and new cards are issued under the new
key. Once the old cards have been re-issued or cancelled, remove
`AQUA_GATE_SECRET_PREVIOUS`. **That removal is the moment the old cards
stop working**, so it is deliberate and observable, never a side effect.

**Not rotated in place.** A credential is not re-hashed when it is
verified under the previous key: its digest stays on the key that issued
it until it is re-issued or revoked. Re-hashing it in the middle of a
scan would change what a later replay of the same event is compared
against.

**The HKDF label is a wire format.** The derivation label
`aqua:gate:credential:v1` is part of the digest, so changing it
invalidates every issued credential. It is not a brand string and a
rename must not touch it.

**Where it is read.** `process.env.AQUA_GATE_SECRET` is read at call
time, the same way `lib/services/premises-qr.ts` reads
`PREMISES_QR_SECRET` — the variable is deliberately not in `lib/env.ts`,
which this lane does not own. A rotation therefore takes effect without a
restart.

**Not yet provisioned in the deployment.** `.env.example`, the compose
files and the harness test profile do not carry the variable yet; those
are shared files and are recorded as blockers in
`docs/handoffs/integration-fixes.md`. The lane's own test fixture
provisions a test-only value, so the tests are self-contained.

---

## 9. Open policy questions for the human

These are decisions the backend does not make on its own. Each is
implemented with the conservative option and flagged.

1. **Does a general (location-wide) membership open a court?**
   Currently **no** — a court gate needs a facility-scoped membership.
   This is what keeps "every member every court" from happening, but it
   means a member whose plan covers the whole academy still has to be
   let in at the court by staff, unless their membership names the
   court facility. *Needs a product decision.*
2. **Should a trial member open a gate?** Currently **yes**, with a
   booking or a membership. A trial member normally has neither, so in
   practice the answer only matters for a trial member who paid for a
   single court booking.
3. **Is there a gate-side lockout for a repeated wrong PIN?** Currently
   **no**: every failed attempt is logged with its reason and nothing
   else happens. A stolen card stays usable until it is revoked. A
   per-gate attempt counter is a policy decision, not an engineering
   one.
4. **Should a revoked card be distinguishable from an unknown one at
   the door?** Currently **no** — the door says "we do not recognise
   that card or PIN" for both, while the staff log keeps the
   distinction. This avoids turning the gate into an oracle for "is
   this tag a real card here?".
5. **How long does the access log live?** Currently **forever** (no
   retention job, no partitioning). A busy academy with three gates
   makes a few hundred rows a day, so this is not urgent, but it needs
   a retention decision before it ships.
6. **Should an override be scoped to one entry or one period?** Currently
   **one entry**: the override grants the member's next entry at that
   gate and is recorded. A time-limited override (an hour of access)
   would need a column this lane does not have.
7. **Can a cancelled card be re-issued with the same tag?** Currently
   **no** — the unique key `(tenant_id, kind, secret_hash)` still holds
   the cancelled digest, so the desk must issue a different tag. This is
   the safer default (a card cancelled because it was *lost* must not
   come back to life), but "replacement card" always means "new tag".
8. **Should a conflicting replay leave a trace?** Currently **no** — the
   conflicting attempt is answered with `denied_event_conflict` and the
   stored row is left exactly as it was, but the attempt itself is not
   written anywhere: the access log's identity is
   `(tenant, device, client event id)` and that identity is already
   taken. A separate "protocol error" record would need a second table
   or a synthetic event id.
9. **Should the door collapse every denial into one message?** Currently
   **no**. A cancelled card already answers like an unknown card (§3), but
   the entitlement messages ("your membership has expired") still tell the
   holder of a *valid* card why the gate stayed shut — and they confirm to
   a tag-sweeper that the tag is real. One opaque "access denied" would
   remove that oracle and the explanation with it. The human asked for
   explicit denials, so the explicitness won; this is the trade-off to
   revisit if tag-sweeping turns up in the field.

---

## 10. Using it

```ts
import { evaluateGateScan } from "@/lib/services/mock-access/gate";

const outcome = await evaluateGateScan({
  tenantId,             // the tenant that owns the gate
  deviceKey: "court1",  // the gate's name inside that tenant
  method: "rfid",
  secret: presentedTag,  // never logged, never stored
  clientEventId: deviceEventId,
});

outcome.decision;  // "granted" | "denied"
outcome.reasonCode; // one of the closed set
outcome.message;    // the line the door shows
```

Management calls (`registerGateDevice`, `issueGateCredential`,
`revokeGateCredential`, `listGateDevices`, `listGateCredentials`) take a
`GateActor` — the narrow capability `{ tenantId, userId, permissions }` —
and require `settings.manage`. The two list calls return an empty list
to a caller without it rather than an error.

**One deliberate deviation from the house rule.** The house rule is
parse-then-permission. These services check the permission *first*, so
an unauthorised caller learns nothing about the shape of the input it
sent. Both checks happen before any database work, which is what the
house rule is protecting; the order between them is a disclosure
choice, and it is made the safe way here.

## 11. Running the tests

```bash
pnpm test tests/mock-access/
```

Each file starts its own disposable Postgres (Testcontainers), applies
every migration and seeds the smallest academy that can answer the
questions: one location, a court facility with two courts, three gates
(`main` PIN+RFID, `court1` RFID, `court2` RFID) and four members (one
booked, one with a membership, one with nothing, one lapsed). The
fixture re-implements the digest derivation independently, so the tests
pin the derivation rather than trusting the helper under test.

The fixture also provisions the gate secret (`AQUA_GATE_SECRET`) for the
tests, and owns the import order: the secret module reads the
environment, so it must be imported *after* the fixture points
`DATABASE_URL` at its own container. A test that imports it statically
would freeze the environment too early — that mistake is why the
fixture exposes the module (`fx.services.secret`) instead.

`tests/mock-access/gate-secret.test.ts` covers the secret contract on
its own: independence from the auth secret, the fail-closed behaviour
for a missing or weak secret, tenant isolation, digest stability, and
the rotation contract (the fleet keeps working while the previous key
is held, stops when it is dropped, and a replay across a rotation is
still the same event).
