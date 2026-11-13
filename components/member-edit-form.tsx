"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { updateMemberAction } from "@/lib/actions/people";
import type { LocationOption, MemberDetail } from "@/lib/services/people";
import { DateField } from "@/components/ui/DateField";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Dialog } from "@/components/ui/Dialog";
import {
  memberEditDocumentNavigation,
  resolveHistoryEditReturn,
  resolveMemberEditReturn,
  useMemberEditOrigin,
  type MemberEditExpectation,
} from "@/components/member-detail/member-edit-entry";
import { hasMembersReturnIntent } from "@/components/members-list-navigation";

export function MemberEditForm({
  member,
  locations,
  returnHref,
  originIntent,
}: {
  member: MemberDetail;
  locations: LocationOption[];
  // Where the owner goes back to: the profile, in the scope the edit was
  // opened under. Optional — a consumer without it keeps today's plain
  // destination.
  returnHref?: string;
  // Present only when the server page can prove which entry this edit came
  // from. The client matches the one-time intent; when it does, Cancel returns
  // with the browser's own Back instead of a fresh profile navigation.
  originIntent?: MemberEditExpectation;
}) {
  const router = useRouter();
  const profileHref = returnHref ?? `/owner/members/${member.memberId}`;
  const capturedOrigin = useMemberEditOrigin(originIntent ?? null);
  const [fullName, setFullName] = useState(member.fullName);
  const [phone, setPhone] = useState(member.phone ?? "");
  const [dateOfBirth, setDateOfBirth] = useState(member.dateOfBirth ?? "");
  const [joinedOn, setJoinedOn] = useState(member.joinedOn);
  const [gender, setGender] = useState(member.gender ?? "");
  const [locationId, setLocationId] = useState(member.locationId);
  const [medicalNotes, setMedicalNotes] = useState(member.medicalNotes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dirty = fullName !== member.fullName || phone !== (member.phone ?? "") ||
    dateOfBirth !== (member.dateOfBirth ?? "") || joinedOn !== member.joinedOn ||
    gender !== (member.gender ?? "") || locationId !== member.locationId ||
    medicalNotes !== (member.medicalNotes ?? "");

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
      router.push(profileHref);
    } catch {
      setError("The change could not be saved. Check the fields and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2.5">
      {/* OpenPen owner reference — a bounded correction form: persistent
          labels, paired fields at ≥sm, and Cancel beside Save. */}
      <h2 className="font-display text-[16px] font-semibold">
        Personal details
      </h2>
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
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
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
        <Field id="edit-dob" label="Date of birth" required>
          {(field) => (
            <DateField
              {...field}
              value={dateOfBirth}
              onChange={setDateOfBirth}
              data-testid="member-dob"
            />
          )}
        </Field>
        <Field id="edit-joined-on" label="Joined on">
          {(field) => (
            <DateField
              {...field}
              value={joinedOn}
              onChange={setJoinedOn}
              data-testid="member-joined-on"
            />
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
      </div>
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

      <div className="flex gap-2 pt-1">
        {originIntent ? (
          // Owner-aware Cancel: a REAL anchor. When the origin is proven (or a
          // scoped directory return must be preserved) the handler takes the
          // click; otherwise the browser performs a normal document navigation
          // to the canonical profile href — there is no scoped state to lose,
          // and it avoids the stalled forward-RSC path. The control is chosen
          // from a server prop, so server and client render the same element.
          <a
            href={profileHref}
            className={`${buttonClasses({ variant: "secondary", size: "md" })} flex-1`}
            onClick={(event) => {
              if (busy || dirty) {
                event.preventDefault();
                if (!busy) setConfirmDiscard(true);
                return;
              }
              // A modified click belongs to the browser.
              if (
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey ||
                event.button !== 0
              ) {
                return;
              }
              // Proven origin (module capture or this entry's own record):
              // return the way it came.
              if (
                resolveMemberEditReturn(capturedOrigin, originIntent) ??
                resolveHistoryEditReturn(originIntent)
              ) {
                event.preventDefault();
                router.back();
                return;
              }
              // No proven origin, but the in-memory directory return for THIS
              // namespace and facility would be lost by a document load: keep
              // the client route.
              if (hasMembersReturnIntent(originIntent.namespace, originIntent.facility)) {
                event.preventDefault();
                router.push(profileHref);
              }
            }}
          >
            Cancel
          </a>
        ) : (
          // Legacy consumer without the optional props: today's Next Link.
          <Link
            href={profileHref}
            className={`${buttonClasses({ variant: "secondary", size: "md" })} flex-1`}
            onClick={(event) => {
              if (busy || dirty) {
                event.preventDefault();
                if (!busy) setConfirmDiscard(true);
              }
            }}
          >
            Cancel
          </Link>
        )}
        <Button
          type="button"
          variant="primary"
          size="md"
          onClick={submit}
          disabled={busy}
          className="flex-[2]"
        >
          {busy ? "Saving…" : "Save changes"}
        </Button>
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
            if (!originIntent) {
              router.push(profileHref);
              return;
            }
            if (
              resolveMemberEditReturn(capturedOrigin, originIntent) ??
              resolveHistoryEditReturn(originIntent)
            ) {
              router.back();
              return;
            }
            if (hasMembersReturnIntent(originIntent.namespace, originIntent.facility)) {
              router.push(profileHref);
              return;
            }
            // Direct edit with no proven origin and no scoped state to keep.
            memberEditDocumentNavigation.assign(profileHref);
          }}>Discard changes</Button>
        </>}
      />
    </div>
  );
}
