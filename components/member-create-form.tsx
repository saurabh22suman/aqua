"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { createMemberAction, searchPersonsAction } from "@/lib/actions/people";
import { CURRENT_POLICY_VERSION } from "@/lib/schemas";
import type { LocationOption, PersonSearchRow } from "@/lib/services/people";
import { formatPhoneIN } from "@/lib/phone";
import { DateField } from "@/components/ui/DateField";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { MemberConsentChoices } from "@/components/member-consent-choices";
import {
  resolveTerm,
  titleCase,
  type TerminologyState,
} from "@/lib/terminology/keys";

// Rough client-side age check for immediate UI feedback only -- the
// server (isMinor, lib/time/tz.ts) is the real, tenant-timezone-aware
// authority and is checked again inside createMember.
function looksLikeMinor(dateOfBirth: string): boolean | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return null;
  const dob = new Date(dateOfBirth);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1;
  return age < 18;
}

type GuardianChoice =
  | { mode: "none" }
  | { mode: "existing"; personId: string; label: string }
  | { mode: "new" };

export function MemberCreateForm({
  locations,
  memberDetailBasePath = "/owner/members",
  terminology,
}: {
  locations: LocationOption[];
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
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [joinedOn, setJoinedOn] = useState("");
  const [gender, setGender] = useState("");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
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
  const [busy, setBusy] = useState(false);

  const minor = useMemo(() => looksLikeMinor(dateOfBirth), [dateOfBirth]);

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
    if (!fullName.trim() || !dateOfBirth || !locationId) {
      setError("Full name, date of birth and location are required.");
      focusField(!fullName.trim() ? "member-full-name" : "member-dob");
      return;
    }
    if (!consentGiven) {
      setError(
        `Consent to data processing is required before a ${resolveTerm(terminology, "member", 1)} can be registered.`,
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
      router.push(`${memberDetailBasePath}/${result.memberId}`);
    } catch {
      // R07 (2026-10-13 role-workflow audit) — a refused or failed
      // submission must not become an uncaught rejection. The form
      // keeps every field (controlled inputs) so nothing is lost.
      setError(
        "Could not save the member. You may not have permission to register members — check with the owner.",
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
    <div className="space-y-5 pb-[calc(10.5rem+env(safe-area-inset-bottom))] lg:pb-32">
      <section className="space-y-2.5">
        {/* Owner redesign (C2) — the shared labelled controls. The
            labels are associated with their control by id, the metrics
            (16px text, the 44px floor, the focus ring) belong to the
            shared primitives, and no page-local surface override is
            added on top of them. */}
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
        <Field id="member-phone-field" label="Phone (optional)">
          {(field) => (
            <Input
              {...field}
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone (optional)"
            />
          )}
        </Field>
        <Field id="member-dob" label="Date of birth">
          {() => (
            <DateField
              id="member-dob"
              value={dateOfBirth}
              onChange={setDateOfBirth}
              data-testid="member-dob"
            />
          )}
        </Field>
        <Field id="member-joined-on" label="Joined on (optional — defaults to today)">
          {() => (
            <DateField
              id="member-joined-on"
              value={joinedOn}
              onChange={setJoinedOn}
              data-testid="member-joined-on"
            />
          )}
        </Field>
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
        <Field id="member-location-field" label="Location">
          {(field) => (
            <Select
              {...field}
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
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
          <h3 className="text-[13px] font-semibold">
            {titleCase(resolveTerm(terminology, "guardian", 1))} required — this {resolveTerm(terminology, "member", 1)} is a minor
          </h3>

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
              <Field id="guardian-new-phone-field" label="Guardian phone (optional)">
                {(field) => (
                  <Input
                    {...field}
                    type="tel"
                    value={guardianPhone}
                    onChange={(e) => setGuardianPhone(e.target.value)}
                    placeholder="Guardian phone (optional)"
                  />
                )}
              </Field>
            </>
          )}

          <Field
            id="guardian-relationship-field"
            label={`Relationship to ${resolveTerm(terminology, "member", 1)}`}
          >
            {(field) => (
              <Input
                {...field}
                type="text"
                value={relationship}
                onChange={(e) => setRelationship(e.target.value)}
                placeholder={`Relationship to ${resolveTerm(terminology, "member", 1)} (e.g. mother, father)`}
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

      <MemberConsentChoices minor={minor} memberLabel={resolveTerm(terminology, "member", 1)}
        processing={consentGiven} communications={communicationsGiven}
        onProcessing={setConsentGiven} onCommunications={setCommunicationsGiven} />

      {error ? (
        <p className="text-[13px] text-late" role="alert">
          {error}
        </p>
      ) : null}

      {/* Sticky save bar [automatable]: this is the longest form in the
          product, and with the guardian section open the submit scrolls
          two viewports down. The bar pins above the fixed bottom nav
          (4rem + safe-area + gap) so Save is always one thumb-tap away.
          R-D1 (2026-09-13 audit): the mandatory consent/guardian
          content can be below the fold from here, so an incomplete
          form states what is still required in the bar itself, and a
          failed submit scrolls to the field. shadow-2 is the
          floating-element level per DESIGN.md §1.4. */}
      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom)+0.75rem)] rounded-ctl border border-line bg-paper p-2 shadow-2">
        {!consentGiven || (minor === true && guardianMissing) ? (
          <p className="px-1 pb-1.5 text-center text-[12px] text-warn">
            {!consentGiven
              ? "Consent is required before saving."
              : `A ${resolveTerm(terminology, "guardian", 1)} is required before saving.`}
          </p>
        ) : null}
        <Button
          type="button"
          variant="primary"
          size="lg"
          onClick={submit}
          disabled={busy}
          className="w-full"
          data-testid="submit-member"
        >
          {busy ? "Saving…" : `Add ${resolveTerm(terminology, "member", 1)}`}
        </Button>
      </div>
    </div>
  );
}
