"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Select } from "@/components/ui/Select";
import { enrollMemberSignInAction } from "@/lib/actions/member-link-binding";
import type { MemberAccessRead } from "@/lib/services/member-link-readmodel";

export function MemberEnrollmentForm({ read }: { read: MemberAccessRead }) {
  const router = useRouter();
  const [subject, setSubject] = useState("member");
  const [phone, setPhone] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const choice = (read.guardianChoices ?? []).find(
    (item) => item.guardianshipId === subject,
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ack || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await enrollMemberSignInAction({
        audience: subject === "member" ? "member" : "guardian",
        memberId: read.memberId,
        guardianshipId: choice?.guardianshipId,
        phone,
        identityAcknowledged: true,
      });
      if (result.kind !== "ok") {
        setMessage("Could not set up this sign-in. Check the details and try again.");
        return;
      }
      setPhone("");
      setAck(false);
      setMessage("Sign-in set up. Confirm the pairing below, then create a private invitation to hand over.");
      router.refresh();
    } catch {
      setMessage("The response was lost. Refresh the page before trying again. The setup may have completed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-4 rounded-card border border-line bg-paper p-4">
      <h2 className="text-base font-medium">Set up sign-in</h2>
      <p className="mt-1 text-sm text-ink-2">
        Choose the person and enter their sign-in number. It may differ from
        the club record. Keep the invitation private and hand it to them yourself.
      </p>
      <form onSubmit={submit} className="mt-3 grid gap-3">
        <div>
          <Label htmlFor="enrollment-person">Person</Label>
          <Select
            id="enrollment-person"
            value={subject}
            disabled={busy}
            onChange={(event) => {
              setSubject(event.target.value);
              setAck(false);
            }}
          >
            <option value="member">{read.memberName} (member)</option>
            {(read.guardianChoices ?? []).map((item) => (
              <option key={item.guardianshipId} value={item.guardianshipId}>
                {item.personName} ({item.relationship})
              </option>
            ))}
          </Select>
        </div>
        {choice ? (
          <p className="text-sm text-ink-2">
            Club record: {choice.clubPhone ?? "No number recorded"}
          </p>
        ) : null}
        <div>
          <Label htmlFor="enrollment-phone">Sign-in phone number</Label>
          <Input
            id="enrollment-phone"
            type="tel"
            required
            maxLength={40}
            autoComplete="off"
            disabled={busy}
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value);
              setAck(false);
            }}
          />
        </div>
        <Checkbox checked={ack} disabled={busy} onCheckedChange={setAck}>
          I checked that this sign-in account belongs to {choice?.personName ?? read.memberName}.
        </Checkbox>
        <Button type="submit" disabled={!ack || busy} className="w-fit">
          {busy ? "Working…" : "Set up sign-in"}
        </Button>
        {message ? <p role="status" className="text-sm">{message}</p> : null}
      </form>
    </section>
  );
}
