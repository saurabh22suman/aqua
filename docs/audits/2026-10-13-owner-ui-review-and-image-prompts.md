# Owner UI review and GPT Image mockup prompts

**Date:** 13 Oct 2026  
**Scope:** all 38 page routes under `app/(owner)/owner`, owner navigation, all five Fees tabs, all five member-profile tabs, and an expanded invoice/payment panel.  
**Basis:** current working tree, three parallel read-only UI reviewers, and live local demo inspection at **1280×900 desktop** and **390×844 mobile**.

## 1. Verdict

**The owner's dissatisfaction is justified. The owner experience looks like an unfinished operational prototype in a reasonably good design system.** It is consistent enough to recognise, but insufficiently composed to feel like a mature product.

My subjective design assessment is **4/10 for visual composition** and **5/10 for workflow clarity**. These are design judgments, not measured usability scores or a claim that every task fails.

The main problem is not the absence of gradients, animation, fashionable colours or illustrations. It is that most desktop pages remain **wide, vertically stacked phone layouts**. The interface allocates space without using it to help the owner compare, decide and act.

### What feels weak

1. **Desktop space is not doing useful work.** Forms stretch across nearly the entire workspace. Related evidence and actions sit one below another rather than together. Reports and profile pages become unnecessarily long.
2. **Different tasks receive the same composition.** A financial ledger, a settings directory, a roster and a registration form need different structures. Rounded containers do not supply that structure.
3. **Creation frequently precedes management.** Programs, Enquiries, Activities, Plans, Roster and Payment QRs lead with expanded forms. Returning owners must pass the creation UI before reaching existing records.
4. **Comparison is difficult.** Batch details are sentences instead of aligned columns. Schedule days contain independent lists rather than aligned time positions. Prices and statuses often live inside prose.
5. **The hierarchy is uneven.** The member identity card dominates every tab; notification settings appear before enrolment/subscription; reports give sparse charts huge areas. Important actions compete with secondary administrative controls.
6. **Mobile adaptation is frequently compression rather than restructuring.** Session names truncate, roster metadata competes for width, and the transaction amount starts offscreen in a horizontally scrolling table.
7. **User-facing copy leaks implementation language.** Examples include `tenant:<UUID>`, `[object Object]`, E.164, canonical database identifiers, and “next staff cycle.” These make the product feel internally oriented.
8. **State correctness needs attention alongside visuals.** Reviewers identified stale-state, context-loss, permission-affordance and failure-recovery risks. A mock image cannot fix these.

### What is worth keeping

- The light, high-contrast identity is appropriate for daylight and poolside use.
- Bricolage Grotesque and Instrument Sans are distinctive without being impractical.
- Semantic money/attendance colours, actual status words and the capacity lane strip are useful product language.
- The grouped desktop sidebar is a real improvement over a phone-only shell.
- Member participation and paid-plan lifecycle are explicitly separate.
- Fees contains real invoice/payment/receipt/reversal workflows rather than decorative analytics.
- Several lists use restrained divided rows. Small curated staff lists are not inherently wrong as row cards.
- Consent, unavailable document uploads and untracked expenses are represented explicitly, although some wording and placement need improvement.

**Recommended direction:** a calm, precise academy operations workspace. Modernity should come from alignment, readable density, consistent controls, useful grouping and clear next actions.

## 2. Evidence and limits

- Signed into the existing local synthetic demo on port 3100 using its documented owner login. No demo reset, seeding or application changes were needed.
- Inspected every route family with representative member, batch, enquiry and staff records. Dynamic routes were not exhaustively checked for every record.
- Captured both required owner viewports. Local screenshots are in ignored `.playwright-mcp/review-*.png` files. Full-page captures are longer than the viewport; each was taken with the stated viewport width/height.
- Inspected Fees Overview/Transactions/Dues/Invoices/Plans and member Overview/Payments/Progress/Notes/Documents. Also opened an existing partially paid invoice. No payment, profile, leave, invitation, reconciliation or settings mutation was submitted.
- Some first captures include genuine client-panel loading. The member Overview was recaptured after its enrolment/plan/makeup reads completed. Do not interpret a transient loading capture as proof of a permanently broken panel.
- Empty live fixtures include café catalogue, payment QRs, announcements and leave requests. Populated compositions for those are proposals grounded in source-supported capabilities, not observed populated screens.
- Three reviewers independently examined source groups. Their proposed failure/state defects are **source-review findings**, except where explicitly described as observed live. They have not all been reproduced through mutations.
- A limited Impeccable detector scan of owner routes and representative dashboard/member/roster/plan components returned **no findings**. It does not measure hierarchy, workflow integrity, accessibility conformance or production performance.
- Browser captures are from development with the demo banner and development tools. Those are not proposed production UI. Cached service workers and Cache Storage were cleared before the walkthrough.
- This is not a full accessibility, browser-locale, production-bundle or real-user usability certification. No application tests were required for this read-only review.

### Screenshot naming

For static routes, use `.playwright-mcp/review-owner-<route-segments>-desktop.png` and `-mobile.png`. Home uses `review-owner-home-*`. Representative dynamic pages use `review-member-detail-*`, `review-member-edit-*`, `review-batch-detail-*`, `review-enquiry-detail-*`, and `review-staff-detail-*`.

Additional captures: `review-fees-<tab>-*`, `review-member-<tab>-*`, `review-invoice-expanded-*`. Prefer `review-member-overview-*` over the earlier `review-member-detail-*` when evaluating loaded operational panels.

## 3. Every owner page: findings and recommendation

**High:** restructure the workspace or resolve material workflow issues.  
**Medium:** targeted composition/interaction improvements.  
**Light:** preserve the basic structure; polish and clarify.  
These are redesign recommendations, not incident severities. Small settings pages do not need to become dashboards.

| # | Route | Recommendation | Findings and direction |
|---|---|---|---|
| 01 | `/owner` | High | Money-first is correct, but seven full-width attention rows push registers, trends and capacity down the page. Pair money with the decision queue on desktop; group today's operations. |
| 02 | `/owner/members` | Medium | Useful search/status controls and divided rows. Desktop is visually bare; mobile joined date crowds identity. Use an aligned working table, stable person avatars, clearer mobile metadata and restorable filters. |
| 03 | `/owner/members/new` | High | Oversized full-width fields, several placeholder-only labels, no local cancel, and consent near a floating bar. Group identity/guardian/consent in a bounded form; retain minor-specific requirements. |
| 04 | `/owner/members/import` | High | Initial state is only a native file picker. Checked state needs record-level review, clear phases and safer preview/file correspondence. Build a CSV choose/review/result workflow. |
| 05 | `/owner/members/[memberId]` | High | Duplicate identity precedes all five tabs. Overview mixes administrative settings, lifecycle actions and history in a long stack. Lead with one compact person header and a contextual operational workspace. |
| 06 | `/owner/members/[memberId]/edit` | High | Already-filled name/phone lack persistent labels. A wide stack lacks cancel and clear field recovery. Use a constrained correction form with member context and explicit actions. |
| 07 | `/owner/fees` | High | Overview is sparse; dues/invoices use large cards; transaction amount is initially offscreen on mobile. Use a financial workspace with compact summaries, aligned records and invoice-context actions. |
| 08 | `/owner/reports` | High | Long stack, oversized chart areas, weak chart annotation, and a “Collections vs expenses” title despite no expense series. Group real reports and give charts sensible dimensions and readable axes. |
| 09 | `/owner/reports/collections` | High | Evidence and cash-count decision are separated vertically; “lane” labels a location. Scope/date state risks matter more than cosmetics. Put reconciliation alongside its supporting evidence. |
| 10 | `/owner/programs` | High | Two always-visible creation flows and prose-heavy batch rows. Show batches in aligned columns with weekdays; reveal creation/editing contextually. |
| 11 | `/owner/batches/[batchId]` | Medium | Honest summary/waitlist scope, but giant percentage and otherwise sparse content. Use compact attendance evidence next to the ordered queue; repair period link. |
| 12 | `/owner/schedule` | High | Narrow day lists look calendar-like without aligning times; simultaneous sessions are hard to compare. Use a time×day desktop view and a selected-day mobile agenda. |
| 13 | `/owner/sessions` | High | Helpful Manage disclosure, but mobile names truncate and cancelled state is not visible in closed rows. Make this clearly the exception-management list. |
| 14 | `/owner/enquiries` | High | Large capture form dominates an unfiltered list. Identity/source/stage are available but not aligned for scanning. Use a list-first workspace with compact capture. |
| 15 | `/owner/enquiries/[enquiryId]` | High | Lifecycle actions and follow-ups are real, but layout is disjointed; trial/conversion can expose duplicate forms. Use a timeline and one active workflow at a time. |
| 16 | `/owner/announcements` | High | Repeated explanatory copy; composer/inbox/history are three stacked surfaces. Separate composition, sent history and personal notifications; distinguish queued from delivered. |
| 17 | `/owner/staff` | Medium | Stable avatars and readable short rows work. Directory, access and recovery are poorly distinguished. Improve action grouping, comparison and secondary recovery placement. |
| 18 | `/owner/staff/new` | High | New-person mode is understandable; existing-person mode demands an internal UUID. Bound the form; identify staff type separately from login role. A person picker needs implementation support. |
| 19 | `/owner/staff/[staffId]` | Light | Small read-only page should remain small. Use the same avatar as the directory, accurate login copy and an appropriate access-management link; remove roadmap prose. |
| 20 | `/owner/staff/roster` | High | Creation consumes the first screen before the seven-day roster. Publication scope can be coupled to form selection. Week board first, explicit publish scope and contextual add-shift editing. |
| 21 | `/owner/staff/leave` | Medium | Live empty queue is legitimate. Populated review needs pending/history separation, uncovered-session context and reliable recovery. Keep leave-type setup secondary. |
| 22 | `/owner/staff/invitations` | High | Phone-led cards omit recognisable names and place Revoke beside login-link generation. Use identity-first access rows and an explicit destructive confirmation. |
| 23 | `/owner/staff/invitations/new` | High | “Empty = all locations” is counterintuitive access UX; copy sends users to the wrong sharing destination. Make scope explicit and separate access creation from directory records. |
| 24 | `/owner/staff/check-in-qr` | Medium | QR/print purpose is clear. Long raw signed URL dominates; expiry is outside the poster. Create a printable artifact with screen-only controls and exact expiry. |
| 25 | `/owner/settings` | High | Fourteen heterogeneous links live under “Academy.” Group destinations by task; account should not be the reward for scrolling to the end. |
| 26 | `/owner/settings/academy` | Light | Labels and GST explanation are useful. Form is too wide; currency/timezone jargon is unnecessarily technical. Improve grouping and width, not decoration. |
| 27 | `/owner/settings/activities` | High | Creation-first; facility/location/activity vocabulary overlaps; resource editing is cramped. Show location-grouped activity summaries with one selected editor. |
| 28 | `/owner/settings/alerts` | Light | A single threshold is a naturally small task. Explain fixed vs editable rules, constrain the form and improve save/error feedback. |
| 29 | `/owner/settings/branding` | Medium | Six approved accents and actual mark preview are good. Oversized fields/Save and incomplete action preview weaken it. Pair a bounded editor with a useful preview. |
| 30 | `/owner/settings/configuration` | High | Live `[object Object]`, UUID provenance and descriptions used as headings make this feel like an internal admin panel. Use human labels, schema-aware values and scope-aware editing. |
| 31 | `/owner/settings/holidays` | Medium | Compact dated list works; creation fields need labels and a clearer list-first arrangement. Stale state after mutations is a source-review risk. |
| 32 | `/owner/settings/locations` | Medium | Existing two-column address form is better than most settings pages. Business-hours controls are tiny and all sites expand. Separate readable summaries from explicit editors. |
| 33 | `/owner/settings/menu` | Medium | Empty state has guidance. Populated catalogue needs aligned price/tax/visibility, accessible disclosures and less nested editing chrome. |
| 34 | `/owner/settings/payment-qrs` | Medium | Both add methods precede saved QRs. Put collection destinations first, choose an add method, and offer preview; do not suggest automatic payment verification. |
| 35 | `/owner/settings/plans` | High | Preset activation and custom creation sandwich the catalogue. Prices/kinds need clear comparison and honest validation. Catalogue first, one creation mode at a time. |
| 36 | `/owner/settings/skills` | High | Every level/skill is an editor with repeated Save buttons. Use a readable framework hierarchy and one selected four-band editor. |
| 37 | `/owner/settings/terminology` | High | Repeated cards, meaningless universal “marked present” examples, and unsupported locale writes. Use compact term rows and truthful locale availability. |
| 38 | `/owner/onboarding` | Light | Three-task checklist and one next action are good. “Every onboarding step complete” overstates register readiness. Add accurate completion scope and a home destination. |

## 4. How to use the GPT Image prompts

For each image, paste **the shared brief + one numbered page prompt**. These are modular ready-to-paste prompts, not one giant request for 38 screens.

1. Generate the desktop Home first; use the accepted output as the shared visual reference for subsequent screens.
2. Attach the current page screenshot as a **content/workflow reference**. Ask the model to improve composition rather than reproduce the current arrangement.
3. Generate one screen per image. A multi-screen collage usually makes labels unreadable and design decisions inconsistent.
4. Generate mobile separately using the mobile modifier below. Do not ask for a miniature desktop layout inside a phone frame.
5. For long pages, generate the above-the-fold screen first, then a separate continuation or selected-panel image. Do not squash the entire page into one viewport.
6. All mock data is synthetic. Numbers in prompts describe design fixtures, not the reviewed academy's actual finances.
7. Image generation produces a visual specification, not working UI. Controls, new labels, layout transformations, person lookup and confirmation treatments described below must be implemented and verified before being presented as shipped.

### Shared visual brief

```text
Create one high-fidelity product UI mockup for Aqua, a sports academy operations app in India. The user is an academy owner managing members, collections, batches and staff. Render a crisp, straight-on 1280×900 desktop application screenshot, not a marketing page, device mockup or perspective scene. Use readable interface text and realistic synthetic Indian names, ₹ amounts and day-first dates. Design the visible viewport; do not shrink an entire long page to fit.

The aesthetic is calm, precise and contemporary: clear hierarchy, aligned working rows, disciplined spacing, confident typography and useful information density. Retain Aqua's identity: deck background #EDF0EC, white content surfaces, ink #0F1F1C, secondary ink #3C534F, readable muted ink #5B6F6B, marine #0D3B36. Use teal #0E7C86 for actual data. Mango #FF7A18 is the default branding/selection accent; use contrast-safe darker mango #B84E00 with white text for primary buttons. Green, red and amber communicate real paid/present, overdue/absent and attention states, always with words. Do not colour-code unrelated categories decoratively.

Use Bricolage Grotesque for compact display headings and Instrument Sans for controls, body and tabular numbers. Main headings approximately 22px, body 14–16px, input text 16px. Keep Aqua's 20px outer-card and 14px control radius vocabulary, thin restrained dividers, minimal shadows, no nested decorative cards. One dominant action in the active workflow; secondary and destructive actions have different emphasis.

Use a coherent 240px desktop sidebar with academy identity and the existing destinations: Home, Members, Fees & payments, Enquiries, Announcements, Programs & sessions, Staff, Reports, Settings. Use the existing Main/Operations/Insights/Account grouping and a compact record-search top bar. Local breadcrumbs and contextual navigation belong in the workspace. Search covers records; do not present it as a settings-search feature. Show the relevant active destination. Omit demo banners and development-tool overlays.

Do not invent profit, expenses, revenue targets, percentage-growth deltas, payroll, AI features, notification counts, gateways, automatic payment confirmation, unsupported uploads or delivery analytics. No dark mode, gradients, glassmorphism, stock photos, child photos, illustrations or decorative charts. Stable abstract person avatars are allowed. Use only the capabilities specified in the page brief. Produce a polished, buildable interface, with convincing small details rather than generic SaaS metric-card decoration.
```

### Mobile modifier

```text
Generate a separate 390×844 mobile application screenshot for the same page and visual system. No desktop sidebar or device frame. Adapt the structure to the task instead of scaling the desktop down. Retain exactly four bottom-navigation items: Home, Members, Reports, Settings. Keep readable 16px input values and minimum 44×44px touch controls. Use full member/batch identity where possible; relocate secondary metadata rather than truncating essential information. Financial amounts should be visible without horizontal scrolling. A compact action footer may sit above the bottom navigation with enough content clearance. Show the first useful viewport and natural continuation below it. Do not force all page content above the fold. Use the page-specific mobile arrangement below.
```

### Optional state modifier

```text
Create a separate variant of this same screen in [empty / loading / selected / validation-error / failed-read / permission-limited / persisted-success] state. Keep the shell, measurements and typography consistent. Make the state truthful: loading is not empty, queued is not delivered, and a failed read is not a zero balance. Put recovery near the affected control, retain entered values and provide only an action actually supported by the page brief. Do not turn the state into a large decorative illustration.
```

## 5. Page-specific image prompts

### 01. Owner home — `/owner`

```text
Design the owner's daily decision workspace. Header: Aqua Worli Aquatic Club, Tuesday 13 Oct, quiet account action. Use a 60/40 upper composition: a compact marine money panel on the left with “Payments recorded today” ₹18,200 and subordinate Outstanding ₹42,800 / Overdue ₹12,600; on the right a concise “Needs you today” queue with a reason and destination per row, including overdue fees, two overdue enquiry follow-ups and an unstarted register. Below, pair today's register completion with today's batch-capacity lanes: Morning Squad 12/12, Junior TTS 8/16 and Morning Masters 2/16. Use two appropriately sized attendance/collections trend panels labelled “Last 30 days.” Avoid generic welcome copy and large repeated statistic cards. Mobile: money, urgent queue, today's operations, existing shortcuts to Fees/Enquiries/Programs/Staff, then trends.
```

### 02. Member directory — `/owner/members`

```text
Design a working swimmer directory, not a dashboard. Header “Swimmers,” secondary Import and primary Add swimmer. A compact toolbar contains the existing name/phone search and participation-status filter. Use a white desktop table with stable abstract person avatar, name and member code/location together, phone, joined date and status. Show eight synthetic records with active, paused and lapsed examples. Align columns, make the name the clear row destination and keep dates secondary. Do not invent plan, balance, bulk selection or export columns. Mobile: identity and status on the first line, code/location and phone below, joined date as quiet secondary metadata. Do not squeeze joined date beside the name.
```

### 03. New member — `/owner/members/new`

```text
Design “Add swimmer” as a bounded 760px registration workspace with a roster breadcrumb. Group persistent labelled fields into Personal details, Guardian and Consent. Show synthetic minor Aaradhya Iyer, DOB 23 Sept 2016: name, optional phone, DOB, joined date, optional gender, location and medical notes. Guardian mode supports existing-person search or new guardian details and relationship; selected guardian identity remains visible. Processing consent is required and optional communications consent is separate. Footer: Cancel and Add swimmer. A sticky mobile footer must not cover consent. Do not add photo upload, plan sale or payment collection. Mobile: single-column sections, guardian summary, consent, concise action bar.
```

### 04. CSV import — `/owner/members/import`

```text
Design “Import swimmers” in its checked-CSV review state. Show a compact phase indicator Choose CSV / Review / Result; filename register-october.csv and Download CSV template. Use fixture counts 40 rows, 36 ready, 4 with errors. Show a bounded sample table of ready records using row number, name, DOB and location; alongside it list explicit row errors and Download error rows. Below show prior-processing-consent attestation and optional evidence reference. One “Import 36 swimmers” action and Change file. Make the preview and selected file visibly belong together. No XLSX support, column-mapping workflow or update-existing promises. Mobile: counts, sample rows, errors, attestation, then concise commit bar.
```

### 05. Member workspace — `/owner/members/[memberId]`

```text
Design Aaradhya Iyer's swimmer workspace with one compact abstract-avatar header: AWS-002, Worli Main, minor, joined 10 Oct, Active participation. Put Edit and Show identity card in secondary header actions; hide the printable card until requested. Preserve tabs Overview, Payments, Progress, Notes, Documents. Overview uses two-thirds operational content and one-third personal context: participation, current Morning Squad enrolment, and paid-plan/subscription status on the left; contacts, guardians, consent and notification destinations on the right. Put makeup credits, facility opt-ins, parent link and attendance/history lower. When no subscription exists, show a quiet empty state and one contextual Start subscription reveal. Mobile: header, tabs, enrolment/subscription, then secondary sections. Never conflate academy participation with paid-plan status.
```

### 06. Member correction form — `/owner/members/[memberId]/edit`

```text
Design “Edit Aaradhya Iyer” as a readable 700px correction form. Include Members / Aaradhya Iyer / Edit breadcrumb and code/location context. Use persistent labels for all prefilled fields: full name, phone, DOB, joined date, optional gender, location and medical notes. Pair related short fields on desktop; medical notes span the form. Show secondary Cancel and primary Save changes, with inline field-error space. Keep guardian, consent, subscription, participation and invoice workflows outside this form. Mobile: one labelled column and compact save/cancel footer with bottom-nav clearance. Do not stretch every field across the desktop workspace.
```

### 07. Fees workspace — `/owner/fees`

```text
Design Fees & payments with existing tabs Overview, Transactions, Dues, Invoices, Plans. Show Dues selected. Display period context separately from current balances: Net collections for 1–31 Oct, Outstanding now, Overdue now. A compact desktop table shows swimmer, invoice number, due date, total, balance, document state and Open. Use a partial invoice INV/2026-27/0001: ₹2,800 total, ₹1,000 recorded, ₹1,800 outstanding, overdue. Expand one selected invoice inline into actual breakdown, payments/receipts and Record payment. Keep reversal and void distinct, permission-limited destructive actions. No profit, expense, discount or gateway cards. Mobile: compact summaries and divided invoice rows with amounts immediately visible; make horizontal tab continuation obvious.
```

### 08. Reports — `/owner/reports`

```text
Design a reporting workspace with concise actual date-range context and a proposed control for the already-supported range parameters. Keep Daily collections and Fees & payments as secondary navigation. Use deliberate two-column desktop grouping: Collections over time beside Collections by plan; Attendance trend beside member-status mix; below, Attendance by batch with CSV export, then compact enquiry funnel, aggregate retention, coach load and facility utilisation. Charts have readable dates, axes, legends, compact heights and truthful empty states. Label the single financial series “Collections,” with a small note that expenses are not tracked. Never manufacture an expense series, profit, target or comparison delta. Mobile: collections then attendance then secondary operational sections, without huge sparse plot areas.
```

### 09. Daily cash reconciliation — `/owner/reports/collections`

```text
Design Daily collections around one explicit day and location, 13 Oct / Worli Main. Header includes date and location, not “lane.” Show fixture total ₹18,200 and system cash ₹8,400. Use 60/40 columns: method and received-by-staff tables on the left; cash-count decision on the right. The count panel keeps system cash visible beside Counted cash, prospective variance, reason and Confirm count. State the existing reason requirement over ₹500 and management-review threshold over ₹2,000. A separate closed variant shows counted/system/variance/confirmer/time and permitted Reopen with reason. Mobile: scope, total/system cash, count decision, then evidence. No balance adjustment, automatic reconciliation or implicit recount.
```

### 10. Programs and recurring batches — `/owner/programs`

```text
Design Programs as a batch-management workspace. A compact programs grouping area contains Learn to swim, Junior competitive and Stroke development. The main desktop batch table aligns batch name, program, weekdays, start/end time, capacity, location and coach. Show Morning Squad, Junior TTS, Trial Squad, Morning Masters and Late Squad. Keep batch summary links, Edit/Delete, and existing Sessions navigation. Add program and Add batch reveal one contextual labelled form at a time. Show an inline coach-conflict warning in an edit variant. No profitability or draggable schedule controls. Mobile: divided batch rows with readable recurrence/time and coach metadata; creation form is explicitly revealed, not permanently above the list.
```

### 11. Batch attendance and waitlist — `/owner/batches/[batchId]`

```text
Design Morning Squad's batch summary within its actual limited scope. Show Programs breadcrumb, batch identity, October attendance 82%, and precise “69 Present or Late out of 84 recorded marks”; distinguish scheduled sessions from marked sessions. Pair this compact evidence panel with an ordered waitlist on desktop. Show queue position, swimmer identity, requested date and existing Promote/Remove controls, with a removal-confirmation variant. Keep links to the correctly scoped monthly report and all batches. Do not invent editable recurrence, a full member roster, finance, profit or historical charts on this page. Mobile: compact summary then waitlist, with explicit empty-queue wording when applicable.
```

### 12. Schedule — `/owner/schedule`

```text
Design the generated-session schedule for 12–18 Oct. Desktop: a genuine aligned time×day week grid from 06:00 to 19:00, with daily headers, readable session blocks, batch, coach, location, status and subtle capacity lanes. Put simultaneous Late Squad / Holiday Recovery at the same time so the collision is visible without reading both columns. One compact toolbar holds Prev, Today, Next, Week/Month and any applicable location selection. Creation remains “Add a session via a batch”; do not add drag/drop editing. Mobile: selected-day date navigation and a chronological agenda with full batch names, time, coach and capacity. Preserve date when switching view/location. Treat month as its own calendar view, not thirty squeezed day lists.
```

### 13. Session exceptions — `/owner/sessions`

```text
Design Sessions as the exception-management companion to Schedule. Compact navigation between list and schedule; existing Today / Next 7 days / All 14 days controls. Desktop table: date/time, full batch name, coach, explicit scheduled/cancelled state and Manage. Expand one row for substitute coach, reasoned cancellation and rescheduling with existing conflict feedback. Keep actions contextual and show cancellation confirmation/error near that row. Mobile: date-grouped divided agenda rows, full batch identity above metadata, lifecycle badge and accessible Manage. Do not replace owner exception management with coach attendance marking or add a cosmetic register Save button.
```

### 14. Enquiry directory — `/owner/enquiries`

```text
Design a list-first enquiry workspace. Desktop main region aligns name, optional phone, actual source and current lifecycle stage; show synthetic new, contacted, trial-scheduled, trial-completed, converted and lost examples. A compact side capture panel has labelled Name, Phone optional, Source and Capture enquiry. A proposed local find/stage filter may be shown as an enhancement, with no invented server analytics or assignments. Keep record opening clear. Mobile: populated enquiry rows dominate, with a compact capture reveal rather than a full form taking the first screen. No fabricated overdue counts, lead scores, kanban automation or sales forecasts.
```

### 15. Enquiry lifecycle — `/owner/enquiries/[enquiryId]`

```text
Design Meera Nair's enquiry workspace: phone, source Online and stage Contacted in a compact header. Make next actions understandable: Book trial, Convert and secondary Move to lost. Show a follow-up timeline with due date/time in Asia/Kolkata, note and an accessible Mark done control. Use two desktop regions: timeline/evidence and one selected workflow panel. Show either trial booking or conversion, never both registration forms at once. Preserve required DOB, guardian and separate consent when a minor is registered. Mobile: identity/stage, next action, timeline, then one expanded form. No unsupported email composer, lead owner assignment, payment capture or automated follow-up claim.
```

### 16. Announcements — `/owner/announcements`

```text
Design a communications workspace with composer left and Sent history right. Composer has labelled Title, Message, existing Audience choices and conditional batch selection, with one Send announcement action. Use “Pool closed on Saturday” as synthetic content. Explain once that sending creates in-app notifications and queues eligible WhatsApp updates; communications consent applies to student contacts. Sent items show actual supported recipient/queue information, not delivery/read analytics. Clearly separate “Your notifications” from academy sent history, using a compact lower section. Mobile: contextual Compose/Sent/Your notifications presentation without three large competing cards. Include no-recipient, unavailable-send and failed-send variants with honest recovery.
```

### 17. Staff directory — `/owner/staff`

```text
Design an identity-first staff directory with the existing stable abstract avatars. Desktop aligns name, staff type, login state and formatted employed-on date. Show coaches Aanya Rao and Bhaskar Menon, receptionist Rhea and accountant Anil. Primary Add staff; compact contextual Roster and Invitations navigation, with Leave reachable through the existing roster path. Clarify that directory records and login access are different. Keep owner credential recovery in a secondary owner-only section rather than competing with the directory. Mobile: readable short staff rows/cards, wrapping secondary navigation and no crowded four-action heading. Do not add payroll, performance ratings or dismissal workflows.
```

### 18. Add a staff record — `/owner/staff/new`

```text
Design “Add staff record” as a bounded form with clear “Directory record, no login access” explanation and an Invitations link. New person / Existing person selects one mode. New mode contains labelled full name, Staff type and employed-on date. Existing mode must clearly identify a selected person; a proposed authorised person-search control replaces internal UUID entry and requires implementation support. Staff type choices remain coach, receptionist, worker and accountant; do not imply this grants a login role. Footer: Cancel / Add staff. Mobile: one column and explicit selected-person summary. No salary, payroll, KYC or automatic login provisioning.
```

### 19. Read-only staff detail — `/owner/staff/[staffId]`

```text
Design a compact read-only profile for Coach Aanya Rao. Use the same abstract avatar as the staff directory, name and staff type. Show only available identity and login-status information in a restrained definition list. Explain login with accurate phone/PIN wording and offer a permitted Invitations destination for access management. Include a Staff breadcrumb. Leave comfortable whitespace; do not fill it with invented modules. No Edit, Dismiss, salary, attendance-history, shift or payroll tabs pretending to exist here. Mobile: compact identity followed by access explanation. This page needs polish, not an elaborate dashboard.
```

### 20. Weekly staff roster — `/owner/staff/roster`

```text
Design Roster with the working week first. Header: week 12–18 Oct, explicit location/publication scope, Prev/Today/Next and Publish week. Desktop board uses staff rows and seven day columns with draft/published shift labels and readable times. Show synthetic draft shifts for Aanya, Bhaskar and Rhea. Put the existing Add shift form in a contextual side panel: staff, date, optional template, custom start/end and location when applicable. Keep check-in poster and leave-request navigation compact. Shift templates have a readable catalogue before creation. Mobile: selected-day agenda, contextual Add shift and explicit publication summary. Confirm deletion of a published shift; never let add-form location silently decide publish scope.
```

### 21. Leave review — `/owner/staff/leave`

```text
Design a leave-review workspace with proposed Pending / History grouping. A request row contains staff identity, leave type, start/end dates, duration and reason. Select Aanya Rao's two-day sick request; review panel shows actual uncovered-session context, a note explicitly visible to staff, and Approve/Reject. Provide navigation to the existing Sessions workflow for arranging cover, without inventing automatic substitution. Leave types Casual/Sick/Unpaid and their annual quota/paid setting remain a secondary section. Mobile: request and review first, type setup later. Include an empty queue variant without a fake “Create staff request” action; failed coverage checks are not “No uncovered sessions.”
```

### 22. Access and invitations — `/owner/staff/invitations`

```text
Design Access & invitations as a compact identity-first workspace. Desktop columns: recognisable name, phone, login role, location scope, pending/active state and contextual actions. Name display may require enriching the existing data projection; do not portray that as already shipped. Selected row expands New login link with expiry, Copy and QR, clearly labelled single-use. A separate confirmation variant states the named person's role and consequence before Revoke access. Invite staff is the primary page action. Mobile: named identity above phone/role, scope and restrained actions. Distinguish created/queued/manual sharing; do not claim delivery or expose a one-click destructive revoke as an ordinary secondary action.
```

### 23. Invite a login user — `/owner/staff/invitations/new`

```text
Design Invite staff as an access-creation form separate from Add staff record. Group labelled phone, full name, Login role and Location access. Replace implicit “empty = all locations” presentation with explicit All locations / Selected locations choice and a visible scope summary, translating to the current payload semantics. Role choices remain coach/receptionist/worker/accountant. Desktop: bounded form with an explanatory access-summary rail, not invented fine-grained permission toggles. Footer Cancel / Create invite. After creation, sharing belongs in Invitations; do not call it Roster. Mobile: identity, role, explicit scope, final action. No promise that invite creation means delivery.
```

### 24. Printable staff check-in QR — `/owner/staff/check-in-qr`

```text
Design a purpose-built staff check-in poster preview inside the owner workspace. Screen-only toolbar: Back to roster, Print poster, proposed Open/copy check-in link. Poster contains academy identity, Staff check-in, large black-and-white QR placeholder, concise sign-in/check-in instructions, wrapped fallback link and actual expiry information. The image QR is illustrative, not promised scannable. Keep the long signed URL secondary on screen while retaining a printable fallback. Enable print only when QR is ready in the intended implementation. Mobile: poster then compact controls. No geofence, rotating code or location-verification claim; this is the existing static signed poster workflow.
```

### 25. Settings directory — `/owner/settings`

```text
Design Settings as a task-grouped directory, not a fourteen-card wall. Desktop: two balanced columns of compact destination groups. Academy: profile, locations, activities. Operations: holidays, skills, absence alerts. Billing: membership plans, payment QRs, café menu. Appearance: branding, vocabulary. Advanced: configuration. Keep Staff and Announcements as quiet existing-workspace shortcuts. Account identity and safe Sign out form their own section; setup appears only when incomplete. Each destination has a neutral icon, short title, one-line description and chevron. Mobile: the same groups in one column. No decorative rainbow categories, new settings-search promise or fifth bottom-nav item.
```

### 26. Academy billing identity — `/owner/settings/academy`

```text
Polish Academy profile as a readable-width settings editor. Sections: Academy identity and Billing details. Retain labelled academy name, currency INR, timezone Asia/Kolkata and optional GSTIN. Keep the helpful note that changing GSTIN affects future invoices only. Present technical choices intelligibly; a controlled currency/timezone picker is a proposed enhancement, not a new multi-currency feature. One Save academy profile action with local outcome feedback. Desktop should not stretch four short fields across the console. Mobile: stacked labelled fields and clear save. No logo upload, tax-rate configuration, invoice theme editor or financial summary cards.
```

### 27. Activities and resources — `/owner/settings/activities`

```text
Design a location-grouped activity catalogue with hierarchy Location → Activity → Sub-unit. Show Worli Main / Main pool / four lanes as synthetic content. Desktop aligns activity name, actual kind, capacity and sub-unit count; one selected activity expands labelled name/kind/capacity and resource editing. Existing kinds remain pool, court, table and counter. Add activity opens a contextual form rather than occupying the first populated screen. Mobile: concise activity summary, resource chips/list and accessible labelled Add sub-unit/Edit controls. Confirm deletion and preserve draft after failed addition. No resource booking calendar, inventory, new sport modules or decorative type-colour legend.
```

### 28. Absence rules — `/owner/settings/alerts`

```text
Polish Absence alerts as a small, focused rules editor. Show fixed rule “Three consecutive absences” separately from editable “Monthly attendance below [40] %,” with minimum four marked sessions directly below. Explain that notices appear on coach profile and parent link, with the existing limited frequency. Use one associated numeric label, one Save alert threshold action and local persisted/error feedback. Keep the surface bounded rather than filling available space. Mobile: same simple structure with readable values. No new SMS/WhatsApp/push channel toggles, delivery logs or customizable escalation engine.
```

### 29. Branding — `/owner/settings/branding`

```text
Design Branding with a bounded editor left and useful live-preview panel right. Fields: display name and short name. Six named approved accent choices only: mango, marine, indigo, plum, forest, slate; mango selected with a checkmark. Preview shows Aqua Worli's initials mark, header identity, current-navigation treatment and a sample accessible primary action. Explain once that semantic status colours do not change. One Save branding action at normal scale. Mobile: preview first, names, compact swatch grid, save. No arbitrary colour picker, logo/photo upload, font marketplace, gradients, dark-mode or status recolouring.
```

### 30. Human-readable configuration — `/owner/settings/configuration`

```text
Design “Academy rules” as a human-readable effective-settings workspace. Rows: staff location access, absence threshold, booking advance window and business hours. Each has a short title, concise consequence, current value, human-readable scope/source and an appropriate action. Staff access is platform-controlled with Request change; business hours link to the location-hours editor rather than a text field displaying an object. Keep technical UUID provenance out of the primary view. A selected editable scalar setting expands its control and Save. Mobile: compact rows with contextual editor. No ops-only keys, API secrets, PSP setup or editable structured values pretending to be strings.
```

### 31. Holidays and closures — `/owner/settings/holidays`

```text
Design Holidays & closures with the upcoming dated list first. Show Founder's Day, 24 Oct, and an annual-repeat example with explicit recurrence text. Desktop: compact list beside a labelled Add holiday form; mobile: list and contextual Add holiday reveal. Form includes holiday name, day-first date and accessible annual-repeat choice. Explain that these dates are skipped by session generation, without promising cancellation of already-generated sessions. Include a named removal-confirmation variant and local save/retry feedback. No decorative calendar heatmap, national-holiday import or bulk cancellation workflow.
```

### 32. Location and weekly hours — `/owner/settings/locations`

```text
Design Academy location for a one-site academy. Show Worli Main, address, kind and weekly-hours summary; explicit Edit location and Edit hours sections. In hours editing, align day, open/closed, opening and closing time with labels such as Monday opening time and 44px toggles. Separate Save location from Save hours. Add a second location is quiet and secondary. A multi-site variant uses site summaries and one selected editor rather than every address/hours form open at once. Mobile: site summary, selected editor, then weekly rows. No map, geofence or new location-deletion feature.
```

### 33. Café catalogue — `/owner/settings/menu`

```text
Design Café menu as a counter catalogue editor. Desktop uses category navigation and aligned item rows: name, ₹ price, GST, SAC and visible/hidden state. Show synthetic Water, Tea and Coffee, without food photography. One selected row expands labelled editing; Add category/Add item remain contextual. Preserve Hide/Show and confirmed Archive. Mobile: category sections, item name with right-aligned price, tax metadata beneath and accessible Edit. Also generate an empty variant with one clear Add category action. No inventory quantities, sales analytics, online ordering, image upload or unsupported drag-reorder controls.
```

### 34. Collection QR destinations — `/owner/settings/payment-qrs`

```text
Design Payment QRs around existing collection destinations first. Rows show nickname, generated UPI versus image type, payee identity where available, active/inactive label and a proposed Preview action. Add payment QR opens a choice: Generate from UPI ID or Upload QR image, with only the selected form visible. Generated QR supports amount-prefill; image QR does not. Keep Edit, activation and confirmed Delete contextual. Mobile: compact destination rows and one selected preview/form. Empty variant explains how to provide reception's first QR. No connected-bank badge, automatic settlement, payment verification or gateway onboarding; preview QR art is illustrative.
```

### 35. Sellable plans — `/owner/settings/plans`

```text
Design Membership plans around an aligned active catalogue. Columns: plan name, activity/all-access, actual plan kind, duration or sessions, GST-exclusive ₹ price and contextual Edit/Archive. Distinguish duration, term, class pack, one-time, pay-as-you-go and drop-in. Add plan reveals either preset pricing/activation or custom creation, never two large permanent forms. Show a selected Monthly Swim plan and one field-associated invalid-price variant. Keep tax context visible in edit. Mobile: concise plan rows with price right, metadata beneath and one expanded editor. No revenue charts, discounts, checkout or automatic charge collection.
```

### 36. Skill framework — `/owner/settings/skills`

```text
Design Skill ladder as a framework editor. Desktop left hierarchy: Swimming framework, Beginner/Intermediate/Advanced, existing skills. Main panel shows one selected skill name and four labelled rubric-band textareas. Level name editing is separate and contextual. Emphasize Save only for the active dirty editor, not an orange button under every skill. Mobile: expandable levels/skills, one selected editor. Preserve the actual edit-only capability; do not add Add level, Delete framework or drag reorder. Include honest module-unavailable and empty-framework variants with an actual provisioning/support explanation rather than “add by hand.”
```

### 37. Vocabulary — `/owner/settings/terminology`

```text
Design Vocabulary as eight compact canonical-term rows: member, batch, coach, session, program, facility, guardian, enquiry. Desktop aligns resolved singular, plural, default/custom state and dirty-only Save/Use default. Use real values, not placeholder-only defaults. Sample wording must fit each term: “12 swimmers,” “3 enquiries awaiting follow-up,” “Primary guardian,” not “guardian marked present.” English is editable; Hindi and Bengali are clearly read-only until their write support is implemented. Mobile: compact term sections with paired singular/plural fields. Explain canonical exports briefly, without exposing database jargon as a main heading. No translation engine or global-save behavior that does not exist.
```

### 38. Register readiness — `/owner/onboarding`

```text
Polish the setup checklist with accurate title “Set up your first register.” Exactly three existing checks: Add/import first member, Create batch, Assign coach. Show one completed task and two remaining; a compact marine progress panel emphasizes the next permitted action. Desktop: readable checklist and next-action region, not a full-width ceremonial hero. Mobile: progress, next task, remaining/completed rows and accessible CSV alternative. Include a completed variant with Go to owner home. Completion means these three checks passed, not that billing, all batches, consent or the entire academy is configured. No new wizard steps or fake progress.
```

## 6. Secondary-screen prompts worth generating separately

Use the shared brief and the compact member/fees header from the accepted primary mock. These are separate images, not extra routes.

### Member Payments / expanded invoice

```text
Show the member Payments tab with the compact person header retained. Main surface: invoice rows with number, dates, total, paid, balance and document status. Select partial invoice INV/2026-27/0001 and expand GST/SAC lines, totals, recorded ₹1,000 cash payment, Receipt and secondary Reverse. Record payment has labelled amount/method and reference when required; Raise invoice stays tied to an eligible active subscription. Distinguish invoice voiding from payment reversal and show permission-limited controls truthfully. Mobile puts balance and record-payment context before lower invoice details. No automatic QR confirmation, checkout or gateway.
```

### Member Progress

```text
Show the member Progress tab as read-only assessment information, grouped by framework/level/skill. Use four understandable band markers with text status and recent assessment dates/history when data exists. “Not assessed yet” should not instruct the owner to tap a nonexistent assessment control. Keep the compact member header and quiet structural dividers; no giant card per skill, invented achievement badges or editable coach assessment controls. A separate no-assessments variant remains useful and calm.
```

### Member Notes

```text
Show the member Notes tab with a compact internal-only composer and chronological note list. Label the audience clearly: staff internal, never shown on parent link. Existing actions Add/Edit/Archive stay contextual; one selected edit retains draft with local error/retry space. Keep the member header small so the composer appears promptly. No parent chat, documents, AI summaries or invented note categories.
```

### Member Documents

```text
Show Documents as an honest small unavailable-feature state under the compact member header. State “Document uploads aren't available yet” and point to the existing Overview medical-notes section. Do not display Upload, file lists, drag/drop zones, storage quotas or fake attachments. Do not fill whitespace with decorative artwork.
```

### Fees Overview

```text
Show Fees Overview with period-scoped net collections dominant and current outstanding/overdue secondary. Keep all five existing tabs and explain the difference between period flows and current balances. Use the real limited summary scope confidently; do not fill empty space with fabricated recent-activity widgets, targets or comparisons. Provide clear tab destinations to inspect transactions and dues rather than creating unsupported summary data.
```

### Fees Transactions

```text
Show an aligned financial ledger using existing received time, swimmer, invoice, method/reference and amount. Clearly label negative reversal rows. Desktop is a restrained table. Mobile is a stacked divided ledger where person/date/method are left and the amount is immediately visible right; invoice reference is secondary, not an offscreen column. No bank reconciliation, gateway settlement or export controls unsupported by this view.
```

### Fees Invoices

```text
Show the Invoices tab with all document states, newest first: issued, partial, paid and void. Align total/paid/balance/date and Open. Void is labelled Void, not Settled merely because the balance is zero. Expand one row using the same invoice-detail vocabulary as member Payments. Mobile keeps identity, status and amount readable without horizontal scrolling. No generic payment-create action lacking invoice context.
```

### Fees Plans

```text
Show the read-only Plans tab with name, actual kind, price, activity/all-access, location and archive metadata as appropriate. Authorized Manage plans leads to the existing settings workspace. Keep management editing out of this read-only hub view. No revenue statistics, discount codes or fake subscription sales totals.
```

## 7. Non-visual findings to verify before implementing the redesign

These were identified through current-source review. They should receive focused reproduction and regression verification, not be silently assumed fixed by new layouts.

| Priority | Surface | Source evidence | Risk / fix direction |
|---|---|---|---|
| P1 | Fees Dues/Invoices | `components/fees/fees-invoice-list.tsx:39`; `app/(owner)/owner/fees/page.tsx:65` | Client reload omits facility scope used by initial server rows. Keep scope on hydration, refresh and mutations. |
| P1 | Inline member editing | `components/member-detail/inline-edit-field.tsx:151`; `lib/services/people.ts:391` | Each field submits an original full snapshot; a later field save can overwrite an earlier change. Use canonical shared state or field-scoped updates. |
| P1 | CSV import | `components/member-import-form.tsx:37–45,109` | File changes and out-of-order checks can mismatch preview and committed text. Bind file, preview and request identity. |
| P1 | Cash reconciliation | `components/reports/collections-report.tsx:65,194–204` | Old report can remain under changed date/location; actions use the new scope. Bind evidence and mutation scope, reject stale responses. |
| P1 | Roster publication | `components/staff-roster-board.tsx:96–99` | Publish scope derives from add-shift form location, not necessarily week filter. Separate publication scope and state it explicitly. |
| P1 | Access revocation | `components/invitations-board.tsx:81–91,183–192` | Immediate revocation of active access lacks a named confirmation. Add a consequence-aware safeguard. |
| P1 | Configuration | `components/owner-config-form.tsx:39–49,146–153` | Structured hours stringify as `[object Object]`; observed live. Route to schema-aware location-hours editing. |
| P1 | Holiday list | `components/holidays-board.tsx:21,45,60` | Local state captures initial collection but does not adopt refreshed props. Ensure persisted mutations appear correctly. |
| P1 | Vocabulary locales | `lib/actions/terminology.ts:32,39`; `components/terminology/terminology-form.tsx:80–101` | UI exposes locales not accepted by save/reset; locale navigation can retain previous editor state. Make availability truthful and key editor state to locale. |
| P1 | Plan price | `components/plan-manager.tsx:260–261,352–355` | Invalid-price paths can silently return or omit price while another field succeeds. Associate validation and never claim the rejected price was saved. |
| P1 | Attendance CSV scope | `components/reports/attendance-report-card.tsx:32`; `lib/actions/owner-reports.ts:82` | Export does not carry displayed facility scope. Export must reconcile to on-screen evidence. |
| P2 | Schedule context | `components/owner-schedule-grid.tsx:74–75,219` | Location and view changes omit selected date. Preserve the anchor period. |
| P2 | Batch report link | `app/(owner)/owner/batches/[batchId]/page.tsx:99,121–126` | Helper end boundary repeats start; use the already-computed period. |
| P2 | Period labels | `components/dashboard-trends.tsx:54,109`; `app/(owner)/owner/reports/page.tsx:98` | Rolling ranges say “this month”; exclusive upper dates read as inclusive. Label the actual human range. |
| P2 | Error recovery | notes, subscriptions, staff create/invite, leave review and other editor components | Several thrown-failure paths lack `catch/finally`, draft retention or retry. Clear pending reliably and distinguish uncertain completion. |
| P2 | Permission affordances | member create/edit/import, branding, vocabulary, invitations and announcements pages/components | Some rendered forms check surface/read scope but not the independent write permission or entitlement. This is not proof of unauthorized writes; make UI/action authority consistent. |
| P2 | Focus/labels/targets | configuration, business hours, batch/enquiry/member forms and small disclosure controls | Specific controls suppress the fallback outline, use placeholder-only labels, lack associated names or lack explicit touch sizing. Measure actual focus/contrast/targets during implementation. |

Do not recycle historical contrast failures indiscriminately: the current source uses an accessible darker mango primary surface and updated muted text. Actual foreground/background/focus combinations still need testing, but “white on bright mango everywhere” is not an accurate description of the inspected buttons.

## 8. Recommended redesign order

1. **Define the shared shell and three reusable workspace patterns:** working table/list, bounded editor, and evidence-plus-action split. Keep the identity; improve composition.
2. **Create the high-impact reference mocks:** Home, Members, Member Overview, Fees Dues/expanded invoice, Reports, Schedule and Roster. These determine the visual language for most other pages.
3. **Resolve data/context risks alongside those pages:** facility scope, inline edits, reconciliation, roster publication and period navigation. Prioritize these before treating any mock as implementation-ready.
4. **Apply the patterns to Programs, Sessions, Enquiries and Announcements.** Clarify list/calendar/recurrence and directory/access distinctions.
5. **Reorganise Settings and improve complex editors:** Configuration, Plans, Skills, Terminology and Activities.
6. **Polish the naturally small pages:** Academy, Alerts, read-only Staff detail and Onboarding. Do not overdesign them.
7. **Verify the finished workflow, not just the populated screenshot:** desktop/mobile, empty/selected/loading/error/disabled/permission-limited, long names, exact money, keyboard/touch, retained date/location/filter context and honest delivery states.

### The three acceptance questions

- Can the owner tell **what needs attention and why** in five seconds?
- Can they compare the relevant records **without opening each one or scanning paragraphs**?
- After an action or failure, can they tell **what persisted, which scope it affected and what to do next**?

If the answer to those improves, the redesign will feel genuinely modern. If only the colours, corner radii and shadows change, it will remain the same weak interface with better decoration.

## 9. Follow-up: task ownership before screen redesign

**User feedback:** the academy owner should not be the default person maintaining skill ladders or handling enquiries. This exposes a limitation of the first review: it audited routes currently labelled owner, but route placement does not establish the correct business responsibility.

The directions below are **proposed product responsibilities**, not changed permissions or a completed architecture decision. They supersede the owner-first task emphasis in prompts 14, 15 and 36.

### Skill framework: curriculum work versus student assessment

- **Default framework:** provided by the selected sports preset. `docs/project-scope.md` §5.16 already specifies seeded levels, skills and rubrics; the owner should not need to author a ladder to start using the academy.
- **Academy-specific curriculum maintenance:** belongs to a designated head coach or academic/program lead. That is a responsibility proposal; Aqua does not currently have a distinct head-coach role/curriculum-management grant.
- **Student assessments:** belong to coaches for their authorised students. The existing coach template carries `levels.read` and `levels.assess`.
- **Owner:** oversees the programme and aggregate outcomes, with optional framework viewing or delegated administration. Routine rubric editing should not be a prominent owner task.

Current ladder actions use `settings.manage`, and default owner/admin templates have that authority. The inspected UI edits existing names/rubric bands; it does not offer unrestricted ladder creation. Moving curriculum work requires a narrowly scoped capability and an appropriate staff surface. Do not grant a coach broad `settings.manage` merely to enable rubric editing. Do not assume every coach should be able to change the academy-wide assessment standard.

**Replacement image direction for prompt 36:**

```text
Design an academy curriculum workspace for a designated head coach or academic lead, not the owner's general settings dashboard. Show the existing preset-derived framework, level/skill hierarchy and one selected four-band rubric editor. Keep curriculum maintenance separate from the normal coach's student-assessment flow. Use an appropriately labelled staff workspace; do not invent a shipped Head coach role or permission controls. Ordinary coaches assess authorised students, while the owner receives read-only programme context and aggregate reporting. No repeated owner Save controls or expectation that an owner creates the ladder from scratch. This is a proposed role-specific product mock requiring authority design before implementation.
```

### Enquiries: front-desk execution versus owner oversight

- **Receptionist or designated admissions staff:** captures walk-ins/calls, follows up, schedules trials and performs authorised conversion/admission work.
- **Coach:** runs the trial and supplies coaching feedback where a supported workflow exists. Do not invent a shipped enquiry-outcome control on the coach surface.
- **Owner:** monitors the actual enquiry/conversion reports and escalated/stalled work, with optional drill-down and intervention. Routine lead entry should not dominate the owner experience.
- **Owner-operated academy:** the same person may perform admissions work, but ownership should not make it the default task for every academy owner.

This largely aligns with current capabilities: reception already has `/reception/enquiries` and `/reception/enquiries/[enquiryId]`, with `enquiries.read`/`enquiries.write` in its role template. The owner currently also has access. Access can remain a fallback without making the workflow a primary owner destination.

**Replacement image direction for prompts 14 and 15:**

```text
Design the operational enquiry list and detail flow for reception/admissions. On the mobile reception surface, use its existing Today / Add member / Enquiries / Me navigation, not the owner's bottom navigation. Prioritise rapid capture, readable lead identity/stage, due follow-ups, trial booking and one active conversion workflow with existing guardian/consent requirements. Use current capabilities; individual ownership assignment, coaching trial feedback and escalation features require explicit implementation decisions before controls are shown as available. For the owner, create a separate oversight composition using the real enquiry-source/conversion reporting and existing overdue-follow-up evidence, with secondary record drill-down rather than a large capture form. No invented funnel totals, lead scores or delivery claims.
```

### Design consequence

Before generating the final screen set, distinguish **can access**, **normally performs**, and **needs prominently in navigation**. These are different questions. Apply that responsibility check to each operational module; do not automatically remove all owner access or move every task to reception.
