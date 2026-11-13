"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { AlertTriangle } from "lucide-react";
import { createMemberAction, searchPersonsAction } from "@/lib/actions/people";
import { CURRENT_POLICY_VERSION } from "@/lib/consent-policy";
import type { LocationOption, PersonSearchRow } from "@/lib/services/people";
import { formatPhoneIN } from "@/lib/phone";
import { DateField } from "@/components/ui/DateField";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { MemberConsentChoices } from "@/components/member-consent-choices";
import { Dialog } from "@/components/ui/Dialog";
import { useUnsavedHistoryGuard } from "@/components/use-unsaved-history-guard";
import { parseCalendarDate, todayCalendarDate } from "@/lib/time/calendar";
import { isMinor } from "@/lib/time/tz";
import { isOptionalContactPhoneValid } from "@/lib/contact-phone";
import {
  resolveTerm,
  titleCase,
  type TerminologyState,
} from "@/lib/terminology/keys";

type GuardianChoice =
  | { mode: "none" }
  | { mode: "existing"; personId: string; label: string }
  | { mode: "new" };

export function MemberCreateForm({
  locations,
  initialLocationId,
  cancelHref,
  memberDetailBasePath = "/owner/members",
  terminology,
}: {
  locations: LocationOption[];
  initialLocationId?: string;
  cancelHref?: string;
  // Base path for the new member's detail page, e.g. "/owner/members"
  // or "/reception/members" — each surface has its own detail route so
  // staff land somewhere they can immediately enrol the member in a
  // batch (B3), not a generic "done" screen.
  memberDetailBasePath?: string;
  // Closed-key vocab resolved by the parent server page (L3 audit).
  // Two surface strings ("Guardian required", "the guardian's
  // details") route through here so a swim / gym / football tenant
  // that customises future `guardian` overrides does not drift
  // silently from what the form says.
  terminology: TerminologyState;
}) {
  const router = useRouter();
  const memberLabel = resolveTerm(terminology, "member", 1);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [joinedOn, setJoinedOn] = useState("");
  const [gender, setGender] = useState("");
  const [initialLocation] = useState(() => initialLocationId === "" ? "" : locations.some((location) => location.id === initialLocationId) ? initialLocationId! : locations[0]?.id ?? "");
  const [locationId, setLocationId] = useState(initialLocation);
  const [medicalNotes, setMedicalNotes] = useState("");

  const [guardianQuery, setGuardianQuery] = useState("");
  const [guardianResults, setGuardianResults] = useState<PersonSearchRow[]>([]);
  const [guardian, setGuardian] = useState<GuardianChoice>({ mode: "none" });
  const [guardianName, setGuardianName] = useState("");
  const [guardianPhone, setGuardianPhone] = useState("");
  const [relationship, setRelationship] = useState("");

  const [consentGiven, setConsentGiven] = useState(false);
  const [communicationsGiven, setCommunicationsGiven] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState(false);
  const [guardianPhoneError, setGuardianPhoneError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [discardDestination, setDiscardDestination] = useState<string | null>(null);
  const [backAttempt, setBackAttempt] = useState(false);
  const dirty = Boolean(fullName || phone || dateOfBirth || joinedOn || gender || medicalNotes ||
    locationId !== initialLocation || guardianQuery || guardian.mode !== "none" ||
    guardianName || guardianPhone || relationship || consentGiven || communicationsGiven);
  const historyGuard = useUnsavedHistoryGuard(dirty, busy, () => {
    setBackAttempt(true);
    setConfirmDiscard(true);
  });

  useEffect(() => {
    if (!dirty) return;
    function onLink(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest("a[href]");
      if (!(link instanceof HTMLAnchorElement) || link.target || link.hasAttribute("download")) return;
      const destination = new URL(link.href, window.location.href);
      if (destination.origin !== window.location.origin || destination.href === window.location.href) return;
      event.preventDefault();
      event.stopPropagation();
      if (!busy) {
        setBackAttempt(false);
        setDiscardDestination(`${destination.pathname}${destination.search}${destination.hash}`);
        setConfirmDiscard(true);
      }
    }
    function onUnload(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ""; }
    document.addEventListener("click", onLink, true);
    window.addEventListener("beforeunload", onUnload);
    return () => { document.removeEventListener("click", onLink, true); window.removeEventListener("beforeunload", onUnload); };
  }, [dirty, busy]);

  const today = todayCalendarDate();
  const futureDob = Boolean(dateOfBirth && dateOfBirth > today);
  // Immediate feedback only; the server remains the authority on age and consent.
  const minor = parseCalendarDate(dateOfBirth) && !futureDob
    ? isMinor(dateOfBirth, "Asia/Kolkata") : null;

  async function runGuardianSearch(query: string) {
    setGuardianQuery(query);
    if (query.trim().length < 2) {
      setGuardianResults([]);
      return;
    }
    const results = await searchPersonsAction(query);
    setGuardianResults(results);
  }

  // Guardian-not-present is a real, expected state for a minor with no
  // guardian selected or entered yet -- surfaced honestly here, before
  // the user even tries to submit, rather than as a silent failure or
  // an invented "pending" member state.
  const guardianMissing =
    minor === true &&
    guardian.mode === "none" &&
    !(guardianName.trim() && relationship.trim());

  function guardianInput() {
    if (minor !== true) return undefined;
    if (guardian.mode === "existing") {
      return { existingPersonId: guardian.personId, relationship: relationship.trim() };
    }
    if (guardianName.trim() && relationship.trim()) {
      return {
        fullName: guardianName.trim(),
        phone: guardianPhone.trim() || undefined,
        relationship: relationship.trim(),
      };
    }
    return undefined;
  }

  // 2026-09-13 UI/UX audit R-D1 — the sticky save bar is deliberately
  // always visible (long form), but the mandatory guardian/consent
  // content can sit below the fold. On a failed validation, bring the
  // offending field into view instead of leaving the user at a CTA
  // that appeared to work with no visible cause for the error.
  function focusField(testId: string) {
    const el = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.focus?.();
  }

  async function submit() {
    setError(null);
    setPhoneError(false);
    setGuardianPhoneError(false);
    if (!fullName.trim() || !dateOfBirth || !locationId) {
      setError("Full name, date of birth and location are required.");
      focusField(!fullName.trim() ? "member-full-name" : "member-dob");
      return;
    }
    if (futureDob || !parseCalendarDate(dateOfBirth)) {
      setError(futureDob ? "Date of birth cannot be in the future." : "Choose a valid date of birth.");
      focusField("member-dob");
      return;
    }
    if (!isOptionalContactPhoneValid(phone)) {
      setPhoneError(true);
      focusField("member-phone");
      return;
    }
    if (minor === true && guardian.mode !== "existing" && guardianName.trim() && relationship.trim() && !isOptionalContactPhoneValid(guardianPhone)) {
      setGuardianPhoneError(true);
      focusField("guardian-phone");
      return;
    }
    if (!consentGiven) {
      setError(
        `Consent to data processing is required before a ${memberLabel} can be registered.`,
      );
      focusField("consent-checkbox");
      return;
    }
    if (minor === true && guardianMissing) {
      setError("A guardian is required to register a minor — select an existing one or enter their details.");
      focusField("guardian-search");
      return;
    }

    setBusy(true);
    try {
      const result = await createMemberAction({
        fullName: fullName.trim(),
        phone: phone.trim() || undefined,
        dateOfBirth,
        gender: (gender || undefined) as "male" | "female" | "other" | undefined,
        locationId,
        medicalNotes: medicalNotes.trim() || undefined,
        joinedOn: joinedOn || undefined,
        guardian: guardianInput(),
        consents: [
          {
            purpose: "processing",
            policyVersion: CURRENT_POLICY_VERSION,
            evidence: { channel: "staff-assisted-in-person" },
          },
          ...(communicationsGiven ? [{ purpose: "communications" as const,
            policyVersion: CURRENT_POLICY_VERSION, evidence: { channel: "staff-assisted-in-person" } }] : []),
        ],
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      historyGuard.leave(() => router.push(`${memberDetailBasePath}/${result.memberId}`));
    } catch {
      // R07 (2026-10-13 role-workflow audit) — a refused or failed
      // submission must not become an uncaught rejection. The form
      // keeps every field (controlled inputs) so nothing is lost.
      setError(
        "Could not confirm whether the member was saved. Check the member list before trying again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    // Owner UX audit (high) — the save bar is sticky, so while the
    // form is longer than the viewport it FLOATS over whatever is at
    // the bottom of the screen. That is exactly where the mandatory
    // consent choices live: the bar covered the checkboxes and their
    // copy, and the mobile layout crowded the lower form as well.
    //
    // The reserve below is the bar's own footprint (48px control +
    // its padding and border, plus the gap) AND the fixed bottom nav
    // it pins above, so the last section can always scroll clear of
    // both. Everything stays visible and reachable.
    <div className="space-y-5">
      <section className="space-y-2.5">
        {/* OpenPen owner reference — full name first, then paired fields at
            ≥sm so the editor reads as a bounded form rather than a long
            queue of controls. On 390px every field is one column. */}
        <h2 className="font-display text-[16px] font-semibold">
          Personal details
        </h2>
        <Field id="member-full-name-field" label="Full name">
          {(field) => (
            <Input
              {...field}
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Full name"
              data-testid="member-full-name"
            />
          )}
        </Field>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <Field id="member-phone-field" label="Phone (optional)" error={phoneError ? "Enter a valid phone number." : undefined}>
            {(field) => (
              <Input
                {...field}
                type="tel"
                value={phone}
                onChange={(e) => { setPhone(e.target.value); setPhoneError(false); }}
                placeholder="Phone (optional)"
                data-testid="member-phone"
              />
            )}
          </Field>
          <Field id="member-dob" label="Date of birth" required error={futureDob ? "Date of birth cannot be in the future." : undefined}>
            {(field) => (
              <DateField
                {...field}
                value={dateOfBirth}
                maxIsoDate={today}
                onChange={setDateOfBirth}
                data-testid="member-dob"
              />
            )}
          </Field>
          <Field id="member-joined-on" label="Joined on (optional — defaults to today)">
            {(field) => (
              <DateField
                {...field}
                value={joinedOn}
                onChange={setJoinedOn}
                data-testid="member-joined-on"
              />
            )}
          </Field>
          <Field id="member-location-field" label="Location">
            {(field) => (
              <Select
                {...field}
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
              >
                {initialLocation === "" ? <option value="" disabled>Choose a location</option> : null}
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {initialLocationId === "" && !locationId ? (
            <p className="text-sm text-ink-3">The selected {resolveTerm(terminology, "facility", 1)} is unavailable. Choose an available {resolveTerm(terminology, "facility", 1)} to continue.</p>
          ) : null}
        </div>
        <Field id="member-gender-field" label="Gender (optional)">
          {(field) => (
            <Select
              {...field}
              value={gender}
              onChange={(e) => setGender(e.target.value)}
            >
              <option value="">Not specified</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </Select>
          )}
        </Field>
        <Field id="member-medical-notes-field" label="Medical notes (optional)">
          {(field) => (
            <Textarea
              {...field}
              value={medicalNotes}
              onChange={(e) => setMedicalNotes(e.target.value)}
              placeholder="Medical notes (optional)"
              rows={2}
            />
          )}
        </Field>
      </section>

      {minor === true ? (
        <section className="rounded-card border border-line bg-paper p-3.5 space-y-2.5">
          <h2 className="font-display text-[16px] font-semibold">
            {titleCase(resolveTerm(terminology, "guardian", 1))}
          </h2>
          <p className="text-[12.5px] text-ink-3">
            Required because this {memberLabel} is a
            minor.
          </p>

          {guardian.mode === "existing" ? (
            <div className="flex items-center justify-between rounded-ctl bg-water-soft px-3 py-2">
              <span className="text-[13px] text-water">{guardian.label}</span>
              <button
                type="button"
                onClick={() => setGuardian({ mode: "none" })}
                className="inline-flex items-center min-h-[44px] px-2 text-[12px] text-ink-3 underline"
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <Field
                id="guardian-search-field"
                label={`Search existing ${resolveTerm(terminology, "guardian", "other")}`}
              >
                {(field) => (
                  <Input
                    {...field}
                    type="text"
                    value={guardianQuery}
                    onChange={(e) => runGuardianSearch(e.target.value)}
                    placeholder="Search an existing guardian by name or phone"
                    data-testid="guardian-search"
                  />
                )}
              </Field>
              {guardianResults.length > 0 ? (
                <ul className="rounded-ctl border border-line divide-y divide-line overflow-hidden">
                  {guardianResults.map((r) => (
                    <li key={r.personId}>
                      <button
                        type="button"
                        onClick={() => {
                          setGuardian({ mode: "existing", personId: r.personId, label: r.fullName });
                          setGuardianResults([]);
                        }}
                        className="w-full text-left px-3 py-3 min-h-[44px] text-[14px] hover:bg-deck"
                      >
                        {r.fullName}
                        {r.phone ? <span className="text-ink-3"> · {formatPhoneIN(r.phone)}</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              <p className="text-[12px] text-ink-3">
                Not found? Enter the {resolveTerm(terminology, "guardian", 1)}&apos;s details below.
              </p>
              <Field id="guardian-new-name-field" label="Guardian full name">
                {(field) => (
                  <Input
                    {...field}
                    type="text"
                    value={guardianName}
                    onChange={(e) => setGuardianName(e.target.value)}
                    placeholder="Guardian full name"
                    data-testid="guardian-new-name"
                  />
                )}
              </Field>
              <Field id="guardian-new-phone-field" label="Guardian phone (optional)" error={guardianPhoneError ? "Enter a valid phone number." : undefined}>
                {(field) => (
                  <Input
                    {...field}
                    type="tel"
                    value={guardianPhone}
                    onChange={(e) => { setGuardianPhone(e.target.value); setGuardianPhoneError(false); }}
                    placeholder="Guardian phone (optional)"
                    data-testid="guardian-phone"
                  />
                )}
              </Field>
            </>
          )}

          <Field
            id="guardian-relationship-field"
            label={`Relationship to ${memberLabel}`}
          >
            {(field) => (
              <Input
                {...field}
                type="text"
                value={relationship}
                onChange={(e) => setRelationship(e.target.value)}
                placeholder={`Relationship to ${memberLabel} (e.g. mother, father)`}
                data-testid="guardian-relationship"
              />
            )}
          </Field>

          {guardianMissing ? (
            <div className="flex items-start gap-2 rounded-ctl bg-warn-soft px-3 py-2.5">
              <AlertTriangle size={15} className="text-warn flex-none mt-0.5" />
              <p className="text-[12.5px] text-warn">
                A guardian is required to register a minor. Select an existing guardian above or
                enter their name and relationship — registration cannot continue without it.
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="font-display text-[16px] font-semibold">Consent</h2>
        <MemberConsentChoices minor={minor} memberLabel={memberLabel}
          processing={consentGiven} communications={communicationsGiven}
          onProcessing={setConsentGiven} onCommunications={setCommunicationsGiven} />
      </section>

      {error ? (
        <p className="text-[13px] text-late" role="alert">
          {error}
        </p>
      ) : null}

      {/* OpenPen owner reference — the bounded editor ends with an in-flow
          Cancel/Save pair. The incomplete-form warning stays beside Save so
          the required action is not hidden behind a floating bar. */}
      <div className="rounded-ctl border border-line bg-paper p-2">
        {!consentGiven || (minor === true && guardianMissing) ? (
          <p className="px-1 pb-1.5 text-center text-[12px] text-warn">
            {!consentGiven
              ? "Consent is required before saving."
              : `A ${resolveTerm(terminology, "guardian", 1)} is required before saving.`}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Link
            href={cancelHref ?? memberDetailBasePath}
            className={`${buttonClasses({ variant: "secondary", size: "lg" })} flex-1`}
            onClick={(event) => {
              if (busy || dirty) {
                event.preventDefault();
                if (!busy) { setBackAttempt(false); setDiscardDestination(cancelHref ?? memberDetailBasePath); setConfirmDiscard(true); }
              }
            }}
          >
            Cancel
          </Link>
          <Button
            type="button"
            variant="primary"
            size="lg"
            onClick={submit}
            disabled={busy}
            className="flex-[2]"
            data-testid="submit-member"
          >
            {busy ? "Saving…" : `Add ${memberLabel}`}
          </Button>
        </div>
      </div>
      <Dialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Discard changes?"
        description="Your unsaved changes will be lost."
        hideClose
        footer={<>
          <Button type="button" onClick={() => setConfirmDiscard(false)}>Keep editing</Button>
          <Button type="button" variant="secondary" onClick={() => {
            setConfirmDiscard(false);
            if (backAttempt) historyGuard.discardBack();
            else historyGuard.leave(() => router.push(discardDestination ?? cancelHref ?? memberDetailBasePath));
          }}>Discard changes</Button>
        </>}
      />
    </div>
  );
}
