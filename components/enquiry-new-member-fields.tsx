"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { searchPersonsAction } from "@/lib/actions/people";
import { CURRENT_POLICY_VERSION } from "@/lib/schemas";
import type { LocationOption, PersonSearchRow } from "@/lib/services/people";
import type { NewMemberDetails } from "@/lib/services/enquiries";

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
}: {
  locations: LocationOption[];
  onChange: (details: NewMemberDetails | null) => void;
  onValidityChange: (valid: boolean) => void;
}) {
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState("");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [guardianQuery, setGuardianQuery] = useState("");
  const [guardianResults, setGuardianResults] = useState<PersonSearchRow[]>([]);
  const [guardian, setGuardian] = useState<GuardianChoice>({ mode: "none" });
  const [guardianName, setGuardianName] = useState("");
  const [guardianPhone, setGuardianPhone] = useState("");
  const [relationship, setRelationship] = useState("");
  const [consentGiven, setConsentGiven] = useState(false);

  const minor = useMemo(() => looksLikeMinor(dateOfBirth), [dateOfBirth]);

  async function runGuardianSearch(query: string) {
    setGuardianQuery(query);
    if (query.trim().length < 2) {
      setGuardianResults([]);
      return;
    }
    setGuardianResults(await searchPersonsAction(query));
  }

  function guardianMissing(): boolean {
    return (
      minor === true &&
      guardian.mode === "none" &&
      !(guardianName.trim() && relationship.trim())
    );
  }

  // Recomputes and reports upward whenever any input changes, rather
  // than scattering onChange/onValidityChange calls through every
  // handler (which would read state from before React commits it).
  useEffect(() => {
    const valid = !!(dateOfBirth && locationId && consentGiven && !guardianMissing());
    onValidityChange(valid);
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
      <div>
        <label className="block text-[12px] text-ink-3 mb-1">Date of birth</label>
        <input
          type="date"
          value={dateOfBirth}
          onChange={(e) => {
            setDateOfBirth(e.target.value);
          }}
          className="w-full rounded-ctl border border-line bg-deck px-3 py-2 text-[13px]"
          data-testid="enquiry-member-dob"
        />
      </div>
      <select
        value={gender}
        onChange={(e) => {
          setGender(e.target.value);
        }}
        className="w-full rounded-ctl border border-line bg-deck px-3 py-2 text-[13px]"
      >
        <option value="">Gender (optional)</option>
        <option value="male">Male</option>
        <option value="female">Female</option>
        <option value="other">Other</option>
      </select>
      <select
        value={locationId}
        onChange={(e) => {
          setLocationId(e.target.value);
        }}
        className="w-full rounded-ctl border border-line bg-deck px-3 py-2 text-[13px]"
      >
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>

      {minor === true ? (
        <div className="rounded-ctl border border-line bg-paper p-3 space-y-2">
          <p className="text-[12.5px] font-medium">Guardian required — this is a minor</p>
          {guardian.mode === "existing" ? (
            <div className="flex items-center justify-between rounded-ctl bg-water-soft px-3 py-2">
              <span className="text-[12.5px] text-water">{guardian.label}</span>
              <button
                type="button"
                onClick={() => {
                  setGuardian({ mode: "none" });
                }}
                className="text-[11px] text-ink-3 underline"
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <input
                type="text"
                value={guardianQuery}
                onChange={(e) => runGuardianSearch(e.target.value)}
                placeholder="Search existing guardian"
                className="w-full rounded-ctl border border-line bg-deck px-3 py-2 text-[12.5px]"
              />
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
                        className="w-full text-left px-3 py-2 text-[12.5px] hover:bg-deck"
                      >
                        {r.fullName}
                        {r.phone ? <span className="text-ink-3"> · {r.phone}</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <input
                type="text"
                value={guardianName}
                onChange={(e) => {
                  setGuardianName(e.target.value);
                }}
                placeholder="Or: guardian full name"
                className="w-full rounded-ctl border border-line bg-deck px-3 py-2 text-[12.5px]"
              />
              <input
                type="tel"
                value={guardianPhone}
                onChange={(e) => {
                  setGuardianPhone(e.target.value);
                }}
                placeholder="Guardian phone (optional)"
                className="w-full rounded-ctl border border-line bg-deck px-3 py-2 text-[12.5px]"
              />
            </>
          )}
          <input
            type="text"
            value={relationship}
            onChange={(e) => {
              setRelationship(e.target.value);
            }}
            placeholder="Relationship (e.g. mother)"
            className="w-full rounded-ctl border border-line bg-deck px-3 py-2 text-[12.5px]"
          />
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

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={consentGiven}
          onChange={(e) => {
            setConsentGiven(e.target.checked);
          }}
          className="mt-0.5"
          data-testid="enquiry-consent-checkbox"
        />
        <span className="text-[11.5px] text-ink-2">
          {minor === true
            ? "The guardian above has agreed to data processing, per the current privacy notice."
            : "This person has agreed to data processing, per the current privacy notice."}
        </span>
      </label>
    </div>
  );
}
