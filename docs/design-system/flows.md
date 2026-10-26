# Screen flows — entry, decision, result, recovery

Lane: **Screen contracts** (`design/screen-contracts`), 26 October 2026.
Companion to [screens.md](screens.md) (route and state map) and
[component-usage.md](component-usage.md) (which primitive each step uses).

## What a flow is here

A flow is the *path a person takes to finish one job*, written so that a page
task can be handed to an implementer without a conversation. Every flow has:

- **Entry** — the route the person starts from and the gate they must hold.
- **Steps** — the ordered states, each with the screen it happens on.
- **Decision** — the branch the person's data or permission takes.
- **Result** — what is true when the flow succeeds, and where it lands.
- **Recovery** — what the person sees when a step fails, is refused, or is
  interrupted (network loss, an expired session, a stale link).

Rules that hold in every flow below:

- Money is bigint paise; every date the person reads is Asia/Kolkata.
- A refused action explains itself in one sentence and says what to do next.
- Entered values survive a failed save.
- Nothing in a flow invents data. An unreadable figure is `—` with a reason.
- An offline write is refused outside the one approved offline queue.

## Global entry and exit

| Surface | Entry | Exit (sign out) |
| --- | --- | --- |
| Owner | `/owner` | the account block at the foot of `/owner/settings`, or the shell-level sign-out when the role has no Settings destination |
| Coach | `/coach` | `/coach/me` |
| Reception | `/reception` | `/reception/me` |
| Worker | `/worker` | the sign-out on that page |
| Parent | `/p/[token]` | none — there is no session; the link simply expires |
| Ops | `/ops` | the sidebar sign-out (desktop) or the mobile header sign-out |

An expired tenant session returns the caller to `/login` and keeps no
half-signed-in shell. An expired operator session returns to `/ops/login`.

---

## Auth flows

### A1 — Sign in with a mobile number and a PIN

- **Entry:** `/login`.
- **Gate:** none; the flow establishes the session.
- **Steps:** mobile number → PIN → the session's home route is resolved and
  the caller is sent there.
- **Decision:** the PIN is wrong → the form shows one plain error and keeps
  the phone; unsynced attendance drafts are still on the device → the
  sign-in is held and the person is offered two explicit ways forward, sync
  them or discard them knowingly. Drafts are never discarded silently.
- **Result:** a session cookie scoped to the tenant, and a redirect to the
  surface home the role belongs to.
- **Recovery:** a network failure keeps the typed phone and says the request
  could not be made. The flow never states whether a phone is registered.
  There is no second sign-in path — no password, no social login — and the
  redesign does not add one. The WhatsApp verification journey belongs to
  the PIN reset, not to this screen.

### A2 — Redeem a staff sign-in link

- **Entry:** `/login/link/[token]`.
- **Gate:** the link token is the credential; there is no session yet.
- **Steps:** the link is previewed (without consuming it) → the caller
  confirms → the session is minted → the caller lands on the surface home
  the role belongs to.
- **Decision:** every failure kind — expired, already used, or minted for
  another tenant — renders the **same generic page**. The preview must
  never become an oracle for which links are live.
- **Result:** a session scoped to the tenant, and a redirect to the role's
  home route.
- **Recovery:** a link that cannot be redeemed says so and asks the caller
  to ask the owner for a fresh one. It does not distinguish the reason.

### A3 — Reset a forgotten PIN

- **Entry:** `/login/reset`.
- **Steps:** verify the registered WhatsApp number → choose a new PIN.
- **Decision:** the number does not match a registered login → the same
  neutral message as any other failure; a rate limit states when to retry.
- **Result:** a new PIN; the old one no longer works.
- **Recovery:** the flow is not the staff-management path. Changing a
  credential that already exists is the owner's reset link
  (`/owner/staff`), and `/set-pin` is only the safety net for a session
  that has no credential yet — it never changes an existing PIN.

### A4 — Check in at the premises QR

- **Entry:** `/check-in/[token]` (the QR hangs on a wall, so it is public).
- **Gate:** a tenant session with `staff.self`, plus a token that names the
  caller's own tenant.
- **Decision:** no session → "Sign in first" with a link to `/login`; a
  foreign or expired token → "This QR is not valid"; no staff record at that
  academy → "No staff record"; already checked out → "You are done for
  today".
- **Result:** a check-in row, or a completed day.
- **Recovery:** a failed check-in keeps the page and offers a retry; it never
  reports a check-in that was not recorded.

---

## Owner flows

### O1 — Collect a payment at the desk

- **Entry:** `/owner` (or `/owner/fees`).
- **Gate:** `reports.financial` to open the money screens; `payments.record`
  to record; `invoices.read` to see what is owed.
- **Steps:** Home → the dominant **Collect payment** shortcut → the dues list
  → open the invoice → record the amount and method → confirm.
- **Decision:** the role holds no `payments.record` → the shortcut is not
  rendered at all, because the destination would refuse the save; the
  invoice can still be read.
- **Result:** a payment row in the ledger, the invoice balance updated, and
  the audit row written in the same transaction.
- **Recovery:** a failed save keeps the amount and the method and says the
  payment was **not** recorded — never a success that did not happen, and
  never a double submit. A reversal is a separate, explicit action
  (`payments.refund`), it is ledger-only, and it is never netted into the
  collected total.

### O2 — Find a member and act on their record

- **Entry:** `/owner/members` (or the global record search in the shell).
- **Gate:** `members.read` to read; `members.write` to change.
- **Steps:** search or filter → open `/owner/members/[memberId]` → choose a
  tab (overview, attendance, fees, notes) → act → return.
- **Decision:** the caller is an accountant holding `invoices.read` but not
  `attendance.read` → the record renders the payer-only projection; the
  attendance and child-detail tabs are not rendered rather than half
  rendered.
- **Result:** the change is saved, the audit row is written in the same
  transaction, and the list reflects the new state when the person returns.
- **Recovery:** a failed save keeps every entered value and names the field
  that failed. A record that was deleted while open returns "not found" with
  a way back to the list.

### O3 — Read the day and decide what needs attention

- **Entry:** `/owner`.
- **Gate:** `dashboard.view`.
- **Steps:** read the four summary tiles → read **Today** (sessions with
  occupancy and register completion) → read **Needs you today** (at most
  three rows, each with a reason, an age and a destination) → drill through.
- **Decision:** the day is quiet → the day names the next class with its
  coach, date, time and occupancy; there is no empty block. The chart read
  fails → the chart band degrades to a stated unavailable panel and the rest
  of the page is unaffected.
- **Result:** a decision, not a number: the person either acts on an
  attention row or closes the screen.
- **Recovery:** every drill-through keeps the facility and period the figure
  was computed under, so a person never lands on an unscoped list and
  wonders why the numbers differ.

### O4 — Run today's sessions

- **Entry:** `/owner/schedule` for the read-only grid, `/owner/sessions` for
  the management actions.
- **Gate:** `attendance.read` for the grid; `programs.write` to cancel,
  reschedule or substitute.
- **Steps:** read the grid → open a session → act → confirm.
- **Decision:** the caller holds `attendance.read` but not `programs.write` →
  the grid is read-only and the management controls are absent.
- **Result:** the session is cancelled, rescheduled or reassigned, with the
  audit row in the same transaction.
- **Recovery:** a coach conflict is shown before the change is committed, and
  the conflicting session is named.

### O5 — Set the academy up and keep it correct

- **Entry:** `/owner/settings` → a category → its destination.
- **Gate:** `settings.manage` for every category; `settings.read` for the
  read-only views.
- **Steps:** pick the category (academy, programs and facilities, fees and
  payments, team and access, communications, appearance and advanced) → open
  one destination → change → save.
- **Decision:** the ladder module is off → the skill ladder category is not
  offered; the tenant has one location → the location screen stays singular
  in its wording until a second location exists.
- **Result:** the setting is saved and audited; the change is visible in the
  surface it affects.
- **Recovery:** a failed save keeps the entered value and the field focus.
  A request for a platform-owned setting is submitted as a request, with its
  pending state visible — it is not silently dropped.

### O6 — Tell the academy something

- **Entry:** `/owner/announcements`.
- **Gate:** `messaging.send`.
- **Steps:** choose the audience → write → send → read the delivery result.
- **Decision:** no audience is selected → the send control is unavailable and
  says why; the provider is a mock in this phase and the screen says so.
- **Result:** the announcement is recorded and the notification inbox shows
  it.
- **Recovery:** a failed send reports the failure and keeps the draft; it
  never reports a send that did not happen.

---

## Coach flows

### C1 — Mark today's register

- **Entry:** `/coach` → a session card → `/coach/register/[sessionId]`.
- **Gate:** `attendance.read` to open; `attendance.mark` to mark.
- **Steps:** open the register → mark each swimmer → the lane strip and the
  count update in place → back to today.
- **Decision:** a session is not found → "Session not found" with a way back
  to today; the coach has no `attendance.mark` → the row control is not
  rendered.
- **Result:** the marks are written, the audit row is written in the same
  transaction, and the session's completion is up to date.
- **Recovery:** a failed mark keeps the register open and names the swimmer
  whose mark failed; it does not silently drop the mark.

### C2 — Mark with no connection

- **Entry:** `/coach/register/[sessionId]` while offline.
- **Gate:** the approved offline queue, which requires a live, unexpired,
  scope-matched offline identity.
- **Steps:** the page loads from the offline identity → the coach marks →
  the marks queue on the device → the strip says "offline — saved on device"
  → the person reconnects → the queue syncs.
- **Decision:** the identity is expired or revoked → the page says "Offline
  access ended. Connect and sign in to reload this page." and the mark
  control is unavailable; the queue is off for this tenant → the page says
  it cannot save offline and refuses the write rather than pretending.
- **Result:** the marks reach the server once the connection returns; the
  person can see how many are still pending.
- **Recovery:** a failed sync states how many marks could not be sent and
  keeps them. Logging out purges the queue and the offline identity — an
  unsynced mark is never left on a shared device, and a logout never
  silently discards a pending mark without saying so.

### C3 — Assess a swimmer against the ladder

- **Entry:** `/coach/members` → `/coach/members/[memberId]` → the assess
  action → `/coach/members/[memberId]/assess`.
- **Gate:** `members.read.assigned` for the record, `levels.assess` to
  record, plus the `swim.levels` feature.
- **Steps:** open the swimmer → see current bands → record the assessment →
  the progress view updates.
- **Decision:** the module is off → the ladder is not offered at all; the
  coach is a coach without `levels.assess` → the record is visible and the
  assess control is absent.
- **Result:** the assessment is recorded and the progress view reflects it.
- **Recovery:** a failed save keeps the selected band so the coach does not
  re-pick it.

### C4 — Look after yourself

- **Entry:** `/coach/me`.
- **Gate:** `staff.self`.
- **Steps:** read own shifts, own attendance and own leave → request leave →
  see the request's state.
- **Decision:** a request needs approval → the card says it is pending; the
  coach cannot approve their own request (that is `staff.roster`).
- **Result:** the request is recorded with its state.
- **Recovery:** a failed request keeps the typed reason and dates.

---

## Reception flows

### R1 — Take a payment at the counter

- **Entry:** `/reception` → **Collect payment** → `/reception/collect-payment`.
- **Gate:** `payments.record` plus the `billing` entitlement.
- **Steps:** show the payer the QR → the payer scans → record the amount and
  method against the invoice → confirm.
- **Decision:** no payment QR is active → the page says so and names the
  owner's settings; the entitlement is off → the shortcut is absent from
  today.
- **Result:** the payment is recorded, the invoice balance updates, and the
  audit row is written in the same transaction.
- **Recovery:** offline, the save is refused with a clear "needs a
  connection" message — a payment is never optimistically recorded. A
  partially-applied save says "check before retrying".

### R2 — Close the counter

- **Entry:** `/reception` → **Close day** → `/reception/close`.
- **Gate:** `payments.record` to count and confirm; `settings.manage` to
  reopen a closed count.
- **Steps:** enter the counted cash → see the variance against the recorded
  total → confirm → the day is closed.
- **Decision:** the count is above the configured threshold → the close is
  refused with the limit named and the amount that tripped it; the
  receptionist tries to reopen a closed count → refused with one sentence,
  because that is management authority.
- **Result:** the cash count is confirmed and locked; the day's collections
  report includes it.
- **Recovery:** a failed confirm keeps the entered count so it is not
  re-typed.

### R3 — Add a member who walks in

- **Entry:** `/reception/members/new` (or the "Add member" bottom-navigation
  item).
- **Gate:** `members.write`.
- **Steps:** fill the form → save → the new member opens.
- **Decision:** the phone number already exists → the field says so and the
  existing record is offered, rather than creating a duplicate. This is
  **not handled today** — the person record's phone column is indexed, not
  unique — so it is a defect for the page task, not a claim about the current
  build.
- **Result:** the member exists, is enrolled if chosen, and the audit row is
  written in the same transaction.
- **Recovery:** a failed save keeps every entered value, including the
  consent choices.

### R4 — Work an enquiry

- **Entry:** `/reception/enquiries` → `/reception/enquiries/[enquiryId]`.
- **Gate:** `enquiries.read`; `enquiries.write` to progress it.
- **Steps:** open the enquiry → advance the stage → book a trial → convert.
- **Decision:** a conversion needs a member record → the flow creates or
  links one inside the same action, so no enquiry is left half-converted.
- **Result:** the stage and the member record agree, and the audit row is
  written in the same transaction.
- **Recovery:** a failed transition keeps the enquiry open with the previous
  stage shown.

### R5 — Take a café order

- **Entry:** `/reception` → **Café** → `/reception/cafe`.
- **Gate:** `payments.record` plus the `cafe.pos` entitlement.
- **Steps:** pick items → the order is open → request the bill → settle.
- **Decision:** the menu is empty → the screen says the menu is empty and
  who fills it; the order is voided → it stays readable and marked voided.
- **Result:** the order is billed and settled, and the payment is recorded.
- **Recovery:** a failed payment keeps the order open; the bill panel can be
  retried without rebuilding the order.

---

## Worker flows

### W1 — Start the day

- **Entry:** `/worker`.
- **Gate:** `staff.self`.
- **Steps:** read the identity block → see today's shift → check in → see
  today's attendance.
- **Decision:** there is no shift today → the card says so and names the next
  one; the caller is not a worker → the page returns "not found".
- **Result:** the check-in is recorded.
- **Recovery:** a failed check-in keeps the card and offers a retry.

### W2 — Ask for leave

- **Entry:** `/worker` → the leave card.
- **Gate:** `staff.self`.
- **Steps:** pick a leave type → set the dates and the reason → submit.
- **Decision:** the request needs approval → the card shows it as pending;
  balances are insufficient → the card states the balance.
- **Result:** the request is recorded with its state.
- **Recovery:** a failed submission keeps the typed reason and dates.

---

## Parent flows

### P1 — Open the link a club shared on WhatsApp

- **Entry:** `/p/[token]`.
- **Gate:** a signed, unexpired link token. There is no account and no
  session.
- **Steps:** the page renders the child, the next session, this month's
  attendance, the plan runway and the read-only money.
- **Decision:** the token is invalid or expired → one generic "This link is
  no longer valid" page, identical to the page shown when the member no
  longer exists, so a probing caller learns nothing; the link has no
  sessions → the page says so in words rather than showing an empty block.
- **Result:** the guardian has read the information and can act on it — the
  receipt links, the contact line, the next session's venue and coach.
- **Recovery:** none is needed: the page has no interactive state and no
  client JavaScript at all. It must stay that way. The page is served
  `no-store`, `no-referrer`, `noindex` and never enters a cache, a manifest
  shortcut or an install prompt.

### P2 — Read a receipt

- **Entry:** a receipt link inside `/p/[token]` →
  `/p/[token]/receipt/[paymentId]`.
- **Gate:** the same token.
- **Decision:** the payment is not found for this token → a generic
  unavailable page that does not confirm the existence of another child's
  payment.
- **Result:** one receipt, exact paise, with the tenant's identity.
- **Recovery:** an expired link leads back to the same generic message as
  P1.

---

## Ops flows

### X1 — Work the attention queue

- **Entry:** `/ops`.
- **Gate:** a platform session (TOTP plus the platform cookie).
- **Steps:** read the queue → open the tenant → act on the tab that matches
  the problem → return to the queue.
- **Decision:** the metrics snapshot has never run → the page says so instead
  of showing zeros; the queue is empty → one quiet sentence.
- **Result:** the operator has acted on the item that needed them.
- **Recovery:** a failed tab load keeps the tenant header and the tabs, and
  names the tab that failed.

### X2 — Create a tenant

- **Entry:** `/ops/tenants` → `/ops/tenants/new`.
- **Gate:** a platform session with write authority; a `viewer` is refused.
- **Steps:** fill the form → create → the tenant opens → apply a preset.
- **Decision:** the slug is taken → the field says so; a preset requires
  answers the lead did not give → the preset page names what is missing
  rather than failing at the end.
- **Result:** the tenant exists with its roles, locations and entitlements,
  and every write is audited.
- **Recovery:** a failed create leaves the form filled in and states what
  failed.

### X3 — Apply a preset to a tenant

- **Entry:** `/ops/presets` → `/ops/presets/[key]` → the tenant's
  configuration tab.
- **Gate:** a platform session with write authority.
- **Steps:** review the preset → choose the tenant → apply → the tenant's
  effective configuration is re-read.
- **Decision:** the preset names a permission that no longer exists → the
  apply is refused and names the unknown permission, rather than silently
  dropping it.
- **Result:** the tenant's configuration matches the preset, and the change
  is audited in the same transaction.
- **Recovery:** a failed apply leaves the tenant on its previous
  configuration and says so.

---

## Cross-cutting: keyboard, offline and recovery

### Keyboard paths

| Surface | First focus | Order | Traps and exits |
| --- | --- | --- | --- |
| Owner | the shell search field | header → summary → dominant action → content → account | the sticky top bar never traps focus; the sidebar scrolls independently without capturing Tab |
| Coach, reception, worker | the page heading's first control | content in DOM order; the bottom navigation comes last | the fixed bottom bar never covers a focused control; the safe area is excluded from the bar's height |
| Parent | nothing — the page has no controls | — | the page must remain free of focusable elements that require JavaScript |
| Ops | the sidebar's first link | sidebar → page header → filters → table | the tab list uses arrow keys; focus is always visible against the dark sidebar |

Rules: no positive `tabindex`; focus is visible on every control; a dialog or
sheet restores focus to its trigger on close and closes on Escape; errors are
announced and focus moves to the first invalid field; a validation message
never appears behind a sticky bar.

### Offline matrix

| Capability | Offline | Condition |
| --- | --- | --- |
| Marking a register | allowed, queued on the device | the approved offline queue, a live unexpired scope-matched offline identity, and the tenant's offline feature enabled |
| Student attendance at the desk | allowed, queued on the device | as above |
| Recording a payment | refused | money never goes offline; the save is refused with a plain reason |
| Editing a member, a fee or a plan | refused | no optimistic financial or personal writes |
| Staff access and settings | refused | identity and entitlement are re-checked online |
| Reading dashboards and lists | not promised | the shell does not promise offline reading; only the approved queue is offline-capable |

The offline identity is scoped to one identity, expires, and is purged on
logout. A stale or revoked identity must stop working offline. A logout must
not silently discard a pending mark: it says what is unsynced.

### Recovery catalogue

| Failure | What the person sees | What is preserved |
| --- | --- | --- |
| A read fails | the page stays, the failed block names itself and offers a retry | the filters, the query and the scroll position |
| A save fails | the field or the form reports the failure and says what to do next | every entered value |
| A save may have partially succeeded | "Check before retrying" | the entered values, and no second automatic submit |
| The session expired | a redirect to `/login` | nothing sensitive on screen |
| A permission is missing | the destination is not rendered, or one plain sentence where it was reached by URL | — |
| The network drops mid-flow | "Needs a connection" | the entered values, and no optimistic success |
| A staff sign-out is requested with unsynced offline marks | the count of unsynced marks is stated before the sign-out completes | the decision is the person's |

### URL state

Tabs, filters and periods are URL state so a shared link opens the same view
and Back does the expected thing. The state that is URL state today:

| Route | Parameters |
| --- | --- |
| `/owner` | `facility`, `trend`, `period` |
| `/owner/fees` | `tab`, and the `group` and `method` filters used by the payment-mix drill-down |
| `/owner/settings` | `category` |
| `/owner/members` | search and filter state |
| `/ops/tenants` | filters and pagination |

Rule: every count and empty state describes the filtered set, not the
unfiltered one, and switching a filter keeps the facility and period scope.
