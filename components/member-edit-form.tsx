"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateMemberAction } from "@/lib/actions/people";
import type { LocationOption, MemberDetail } from "@/lib/services/people";
import { DateField } from "@/components/ui/DateField";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";

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
        phone: phone.trim() || null,
        dateOfBirth,
        gender: (gender || null) as "male" | "female" | "other" | null,
        locationId,
        medicalNotes: medicalNotes.trim() || null,
        joinedOn: joinedOn || undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/owner/members/${member.memberId}`);
    } catch {
      setError("The change could not be saved. Check the fields and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2.5">
      {/* Owner redesign (C2) — the shared labelled controls: the label
          is associated with its control by id, the metrics belong to the
          shared primitives, and no page-local surface override is added
          on top of them. */}
      <Field id="edit-full-name-field" label="Full name">
        {(field) => (
          <Input
            {...field}
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Full name"
          />
        )}
      </Field>
      <Field id="edit-phone-field" label="Phone (optional)">
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
      <Field id="edit-dob" label="Date of birth">
        {() => (
          <DateField id="edit-dob" value={dateOfBirth} onChange={setDateOfBirth} />
        )}
      </Field>
      <Field id="edit-joined-on" label="Joined on">
        {() => (
          <DateField
            id="edit-joined-on"
            value={joinedOn}
            onChange={setJoinedOn}
            data-testid="member-joined-on"
          />
        )}
      </Field>
      <Field id="edit-gender-field" label="Gender (optional)">
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
      <Field id="edit-location-field" label="Location">
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
      <Field id="edit-medical-notes-field" label="Medical notes (optional)">
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

      {error ? (
        <p role="alert" className="text-[13px] text-ink-2">
          {error}
        </p>
      ) : null}

      <Button
        type="button"
        variant="primary"
        size="md"
        onClick={submit}
        disabled={busy}
        className="w-full"
      >
        {busy ? "Saving…" : "Save changes"}
      </Button>
    </div>
  );
}
