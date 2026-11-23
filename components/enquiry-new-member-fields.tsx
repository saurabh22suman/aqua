"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { searchPersonsAction } from "@/lib/actions/people";
import { CURRENT_POLICY_VERSION } from "@/lib/consent-policy";
import type { LocationOption, PersonSearchRow } from "@/lib/services/people";
import type { NewMemberDetails } from "@/lib/services/enquiries";
import { resolveTerm, titleCase, type TerminologyState } from "@/lib/terminology/keys";
import { formatPhoneIN } from "@/lib/phone";
import { DateField } from "@/components/ui/DateField";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";

function looksLikeMinor(dateOfBirth: string): boolean | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return null;
  const dob = new Date(dateOfBirth);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1;
  return age < 18;
}

type GuardianChoice = { mode: "none" } | { mode: "existing"; personId: string; label: string } | { mode: "new" };

// Shared by trial booking and no-trial conversion (both need to
// create a real member -- same DOB/guardian/consent requirements
// C-06's registration flow has, reused here rather than duplicated.
export function EnquiryNewMemberFields({
  locations,
  onChange,
  onValidityChange,
  terminology,
  initialLocationId,
  onGuardianSummaryChange,
}: {
  locations: LocationOption[];
  onChange: (details: NewMemberDetails | null) => void;
  onValidityChange?: (valid: boolean) => void;
  // Closed-key vocab resolved by the parent server page (L3 audit).
  terminology: TerminologyState;
  initialLocationId?: string | null;
  onGuardianSummaryChange?: (value: string) => void;
}) {
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState("");
  const [locationId, setLocationId] = useState(locations.find((site) => site.id === initialLocationId)?.id ?? "");
  const [guardianQuery, setGuardianQuery] = useState("");
  const [guardianResults, setGuardianResults] = useState<PersonSearchRow[]>([]);
  const [searchState, setSearchState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const searchRequest = useRef(0);
  const [guardian, setGuardian] = useState<GuardianChoice>({ mode: "none" });
  const [guardianName, setGuardianName] = useState("");
  const [guardianPhone, setGuardianPhone] = useState("");
  const [relationship, setRelationship] = useState("");
  const [consentGiven, setConsentGiven] = useState(false);

  const minor = useMemo(() => looksLikeMinor(dateOfBirth), [dateOfBirth]);

  function resetGuardianSearch() {
    searchRequest.current++;
    setGuardianQuery("");
    setGuardianResults([]);
    setSearchState("idle");
  }

  async function runGuardianSearch(query: string) {
    const request = ++searchRequest.current;
    const term = query.trim();
    setGuardianQuery(query);
    setGuardianResults([]);
    if (term.length < 2) {
      setSearchState("idle");
      return;
    }
    setSearchState("loading");
    try {
      const matches = await searchPersonsAction(term);
      if (request !== searchRequest.current) return;
      setGuardianResults(matches);
      setSearchState("ready");
    } catch {
      if (request === searchRequest.current) setSearchState("failed");
    }
  }

  function guardianMissing(): boolean {
    return minor === true && (!relationship.trim() ||
      (guardian.mode !== "existing" && !guardianName.trim()));
  }

  // Recomputes and reports upward whenever any input changes, rather
  // than scattering onChange/onValidityChange calls through every
  // handler (which would read state from before React commits it).
  useEffect(() => {
    const valid = !!(dateOfBirth && locationId && consentGiven && !guardianMissing());
    onValidityChange?.(valid);
    const label = guardian.mode === "existing" ? guardian.label : guardianName.trim();
    onGuardianSummaryChange?.(minor === true && valid ? label : "");
    if (!valid) {
      onChange(null);
      return;
    }
    const guardianInput =
      minor === true
        ? guardian.mode === "existing"
          ? { existingPersonId: guardian.personId, relationship: relationship.trim() }
          : { fullName: guardianName.trim(), phone: guardianPhone.trim() || undefined, relationship: relationship.trim() }
        : undefined;
    onChange({
      dateOfBirth,
      gender: (gender || undefined) as "male" | "female" | "other" | undefined,
      locationId,
      guardian: guardianInput,
      consents: [
        { purpose: "processing", policyVersion: CURRENT_POLICY_VERSION, evidence: { channel: "staff-assisted-in-person" } },
      ],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateOfBirth, gender, locationId, guardian, guardianName, guardianPhone, relationship, consentGiven, minor]);

  return (
    <div className="space-y-2.5">
      {/* Owner redesign (C2) — the shared labelled controls. The
          guardian and consent requirements are unchanged. */}
      <Field id="enquiry-member-dob" label="Date of birth" required>
        {(field) => (
          <DateField
            {...field}
            value={dateOfBirth}
            onChange={(value) => {
              setDateOfBirth(value);
              setConsentGiven(false);
              resetGuardianSearch();
            }}
            data-testid="enquiry-member-dob"
          />
        )}
      </Field>
      <Field id="enquiry-member-gender" label="Gender (optional)">
        {(field) => (
          <Select
            {...field}
            value={gender}
            onChange={(e) => {
              setGender(e.target.value);
            }}
          >
            <option value="">Not specified</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </Select>
        )}
      </Field>
      <Field id="enquiry-member-location" label="Location">
        {(field) => (
          <Select
            {...field}
            value={locationId}
            onChange={(e) => {
              setLocationId(e.target.value);
            }}
          >
            <option value="">Select {resolveTerm(terminology, "facility", 1)}</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        )}
      </Field>

      {minor === true ? (
        <div className="rounded-ctl border border-line bg-paper p-3 space-y-2">
          <p className="text-[12.5px] font-medium">
            {titleCase(resolveTerm(terminology, "guardian", 1))} required — this is a minor
          </p>
          {guardian.mode === "existing" ? (
            <div className="flex items-center justify-between rounded-ctl bg-water-soft px-3 py-2">
              <span className="text-[12.5px] text-water">{guardian.label}</span>
              <button
                type="button"
                onClick={() => {
                  setGuardian({ mode: "none" });
                  setRelationship("");
                  setConsentGiven(false);
                  setGuardianName("");
                  setGuardianPhone("");
                  resetGuardianSearch();
                }}
                className="inline-flex min-h-11 items-center text-[11px] text-ink-3 underline"
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <Field id="enquiry-guardian-search" label="Search existing guardian">
                {(field) => (
                  <Input
                    {...field}
                    type="text"
                    value={guardianQuery}
                    onChange={(e) => runGuardianSearch(e.target.value)}
                    placeholder="Search existing guardian"
                  />
                )}
              </Field>
              {searchState === "loading" ? <p role="status" className="text-sm text-ink-2">Searching guardians…</p> : null}
              {searchState === "ready" && guardianResults.length === 0 ? <p role="status" className="text-sm text-ink-2">No matching guardian.</p> : null}
              {searchState === "failed" ? (
                <div className="rounded-ctl bg-warn-soft p-3">
                  <p role="alert" className="text-sm text-ink">Could not search guardians.</p>
                  <button type="button" className="min-h-11 underline" onClick={() => void runGuardianSearch(guardianQuery)}>Retry guardian search</button>
                </div>
              ) : null}
              {guardianResults.length > 0 ? (
                <ul className="rounded-ctl border border-line divide-y divide-line overflow-hidden">
                  {guardianResults.map((r) => (
                    <li key={r.personId}>
                      <button
                        type="button"
                        onClick={() => {
                          setGuardian({ mode: "existing", personId: r.personId, label: r.fullName });
                          setRelationship("");
                          setConsentGiven(false);
                          resetGuardianSearch();
                        }}
                        className="w-full min-h-11 text-left px-3 py-2 text-[12.5px] hover:bg-deck"
                      >
                        {r.fullName}
                        {r.phone ? <span className="text-ink-3"> · {formatPhoneIN(r.phone)}</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <details className="rounded-ctl border border-line px-3">
                <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-ink-2">Add a new {resolveTerm(terminology, "guardian", 1)}</summary>
                <div className="space-y-2 pb-3">
                  <Field id="enquiry-guardian-name" label="Guardian full name">
                    {(field) => (
                      <Input
                        {...field}
                        type="text"
                        value={guardianName}
                        onChange={(e) => {
                          setGuardianName(e.target.value);
                          setConsentGiven(false);
                        }}

                      />
                    )}
                  </Field>
                  <Field id="enquiry-guardian-phone" label="Guardian phone (optional)">
                    {(field) => (
                      <Input
                        {...field}
                        type="tel"
                        value={guardianPhone}
                        onChange={(e) => {
                          setGuardianPhone(e.target.value);
                          setConsentGiven(false);
                        }}
                        placeholder="Guardian phone (optional)"
                      />
                    )}
                  </Field>
                </div>
              </details>
            </>
          )}
          <Field id="enquiry-guardian-relationship" label="Relationship (e.g. mother)">
            {(field) => (
              <Input
                {...field}
                type="text"
                value={relationship}
                onChange={(e) => {
                  setRelationship(e.target.value);
                  setConsentGiven(false);
                }}
                placeholder="Relationship (e.g. mother)"
              />
            )}
          </Field>
          {guardianMissing() ? (
            <div className="flex items-start gap-2 rounded-ctl bg-warn-soft px-3 py-2">
              <AlertTriangle size={14} className="text-warn flex-none mt-0.5" />
              <p className="text-[11.5px] text-warn">
                A guardian is required — select an existing one or enter their name and relationship.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex min-h-11 items-start gap-2">
        <input
          id="enquiry-consent"
          type="checkbox"
          checked={consentGiven}
          onChange={(e) => {
            setConsentGiven(e.target.checked);
          }}
          className="mt-0.5 h-5 w-5 shrink-0"
          disabled={guardianMissing()}
          data-testid="enquiry-consent-checkbox"
        />
        <label htmlFor="enquiry-consent" className="text-[11.5px] text-ink-2">
          {minor === true
            ? "The guardian above has agreed to data processing, per the current privacy notice."
            : "This person has agreed to data processing, per the current privacy notice."}
        </label>
      </div>
    </div>
  );
}
