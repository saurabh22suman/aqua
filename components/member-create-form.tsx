"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { createMemberAction, searchPersonsAction } from "@/lib/actions/people";
import { CURRENT_POLICY_VERSION } from "@/lib/schemas";
import type { LocationOption, PersonSearchRow } from "@/lib/services/people";

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
}: {
  locations: LocationOption[];
  // Base path for the new member's detail page, e.g. "/owner/members"
  // or "/reception/members" — each surface has its own detail route so
  // staff land somewhere they can immediately enrol the member in a
  // batch (B3), not a generic "done" screen.
  memberDetailBasePath?: string;
}) {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
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

  async function submit() {
    setError(null);
    if (!fullName.trim() || !dateOfBirth || !locationId) {
      setError("Full name, date of birth and location are required.");
      return;
    }
    if (!consentGiven) {
      setError("Consent to data processing is required before a member can be registered.");
      return;
    }
    if (minor === true && guardianMissing) {
      setError("A guardian is required to register a minor — select an existing one or enter their details.");
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
        guardian: guardianInput(),
        consents: [
          {
            purpose: "processing",
            policyVersion: CURRENT_POLICY_VERSION,
            evidence: { channel: "staff-assisted-in-person" },
          },
        ],
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`${memberDetailBasePath}/${result.memberId}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="space-y-2.5">
        <input
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Full name"
          className="w-full rounded-ctl border border-line bg-paper px-3 py-2.5 text-[14px]"
          data-testid="member-full-name"
        />
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Phone (optional)"
          className="w-full rounded-ctl border border-line bg-paper px-3 py-2.5 text-[14px]"
        />
        <div>
          <label className="block text-[12px] text-ink-3 mb-1">Date of birth</label>
          <input
            type="date"
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
            className="w-full rounded-ctl border border-line bg-paper px-3 py-2.5 text-[14px]"
            data-testid="member-dob"
          />
        </div>
        <select
          value={gender}
          onChange={(e) => setGender(e.target.value)}
          className="w-full rounded-ctl border border-line bg-paper px-3 py-2.5 text-[14px]"
        >
          <option value="">Gender (optional)</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
          <option value="other">Other</option>
        </select>
        <select
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
          className="w-full rounded-ctl border border-line bg-paper px-3 py-2.5 text-[14px]"
        >
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <textarea
          value={medicalNotes}
          onChange={(e) => setMedicalNotes(e.target.value)}
          placeholder="Medical notes (optional)"
          rows={2}
          className="w-full rounded-ctl border border-line bg-paper px-3 py-2.5 text-[14px]"
        />
      </section>

      {minor === true ? (
        <section className="rounded-card border border-line bg-paper p-3.5 space-y-2.5">
          <h3 className="text-[13px] font-semibold">Guardian required — this member is a minor</h3>

          {guardian.mode === "existing" ? (
            <div className="flex items-center justify-between rounded-ctl bg-water-soft px-3 py-2">
              <span className="text-[13px] text-water">{guardian.label}</span>
              <button
                type="button"
                onClick={() => setGuardian({ mode: "none" })}
                className="text-[12px] text-ink-3 underline"
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
                placeholder="Search an existing guardian by name or phone"
                className="w-full rounded-ctl border border-line bg-deck px-3 py-2 text-[13px]"
                data-testid="guardian-search"
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
                        className="w-full text-left px-3 py-2 text-[13px] hover:bg-deck"
                      >
                        {r.fullName}
                        {r.phone ? <span className="text-ink-3"> · {r.phone}</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              <p className="text-[12px] text-ink-3">Not found? Enter the guardian&apos;s details below.</p>
              <input
                type="text"
                value={guardianName}
                onChange={(e) => setGuardianName(e.target.value)}
                placeholder="Guardian full name"
                className="w-full rounded-ctl border border-line bg-deck px-3 py-2 text-[13px]"
                data-testid="guardian-new-name"
              />
              <input
                type="tel"
                value={guardianPhone}
                onChange={(e) => setGuardianPhone(e.target.value)}
                placeholder="Guardian phone (optional)"
                className="w-full rounded-ctl border border-line bg-deck px-3 py-2 text-[13px]"
              />
            </>
          )}

          <input
            type="text"
            value={relationship}
            onChange={(e) => setRelationship(e.target.value)}
            placeholder="Relationship to member (e.g. mother, father)"
            className="w-full rounded-ctl border border-line bg-deck px-3 py-2 text-[13px]"
            data-testid="guardian-relationship"
          />

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

      <label className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={consentGiven}
          onChange={(e) => setConsentGiven(e.target.checked)}
          className="mt-0.5"
          data-testid="consent-checkbox"
        />
        <span className="text-[12.5px] text-ink-2">
          {minor === true
            ? "The guardian above has agreed to data processing for this member, per the current privacy notice."
            : "This member has agreed to data processing, per the current privacy notice."}
        </span>
      </label>

      {error ? <p className="text-[13px] text-late">{error}</p> : null}

      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className="w-full rounded-ctl bg-[var(--accent)] py-3 text-[14px] font-medium text-white disabled:opacity-50"
        data-testid="submit-member"
      >
        {busy ? "Saving…" : "Add member"}
      </button>
    </div>
  );
}
