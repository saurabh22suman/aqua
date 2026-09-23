"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateMemberAction } from "@/lib/actions/people";
import type { LocationOption, MemberDetail } from "@/lib/services/people";
import { DateField } from "@/components/ui/DateField";

export function MemberEditForm({
  member,
  locations,
}: {
  member: MemberDetail;
  locations: LocationOption[];
}) {
  const router = useRouter();
  const [fullName, setFullName] = useState(member.fullName);
  const [phone, setPhone] = useState(member.phone ?? "");
  const [dateOfBirth, setDateOfBirth] = useState(member.dateOfBirth ?? "");
  const [joinedOn, setJoinedOn] = useState(member.joinedOn);
  const [gender, setGender] = useState(member.gender ?? "");
  const [locationId, setLocationId] = useState(member.locationId);
  const [medicalNotes, setMedicalNotes] = useState(member.medicalNotes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    if (!fullName.trim() || !dateOfBirth || !locationId) {
      setError("Full name, date of birth and location are required.");
      return;
    }
    setBusy(true);
    try {
      const result = await updateMemberAction({
        memberId: member.memberId,
        fullName: fullName.trim(),
        phone: phone.trim() || undefined,
        dateOfBirth,
        gender: (gender || undefined) as "male" | "female" | "other" | undefined,
        locationId,
        medicalNotes: medicalNotes.trim() || undefined,
        joinedOn: joinedOn || undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/owner/members/${member.memberId}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2.5">
      <input
        type="text"
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
        placeholder="Full name"
        className="w-full rounded-ctl border border-line bg-paper px-3 py-2.5 text-[16px]"
      />
      <input
        type="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="Phone (optional)"
        className="w-full rounded-ctl border border-line bg-paper px-3 py-2.5 text-[16px]"
      />
      <div>
        <label htmlFor="edit-dob" className="block text-[12px] text-ink-3 mb-1">
          Date of birth
        </label>
        <DateField id="edit-dob" value={dateOfBirth} onChange={setDateOfBirth} />
      </div>
      <div>
        <label
          htmlFor="edit-joined-on"
          className="block text-[12px] text-ink-3 mb-1"
        >
          Joined on
        </label>
        <DateField
          id="edit-joined-on"
          value={joinedOn}
          onChange={setJoinedOn}
          data-testid="member-joined-on"
        />
      </div>
      <select
        value={gender}
        onChange={(e) => setGender(e.target.value)}
        className="w-full rounded-ctl border border-line bg-paper px-3 py-2.5 text-[16px]"
      >
        <option value="">Gender (optional)</option>
        <option value="male">Male</option>
        <option value="female">Female</option>
        <option value="other">Other</option>
      </select>
      <select
        value={locationId}
        onChange={(e) => setLocationId(e.target.value)}
        className="w-full rounded-ctl border border-line bg-paper px-3 py-2.5 text-[16px]"
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
        className="w-full rounded-ctl border border-line bg-paper px-3 py-2.5 text-[16px]"
      />

      {error ? <p className="text-[13px] text-ink-3">{error}</p> : null}

      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className="w-full rounded-ctl bg-[var(--accent-strong)] py-3 text-[14px] font-medium text-white disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save changes"}
      </button>
    </div>
  );
}
