"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { sendAnnouncementAction } from "@/lib/actions/announcements";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";

// In-app notifications and consent-checked WhatsApp outbox delivery.
//
// Owner redesign (C2) — the composer is a native <form>: Enter in a
// field submits it, and a screen reader announces the real control.
// The fields are the shared primitives, so their metrics and tints stay
// with the foundation owner.

export function AnnouncementComposer({
  batches,
  memberLabel,
  batchLabel,
  guardianLabel,
}: {
  batches: Array<{ id: string; name: string }>;
  // Resolved through resolveTerm on the server (L3 scan: "members"
  // and "batch" change meaning when a preset overrides the closed-key
  // vocabulary).
  memberLabel: string;
  batchLabel: string;
  guardianLabel: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<"all" | "batch" | "parents">("all");
  const [batchId, setBatchId] = useState(batches[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await sendAnnouncementAction({
        title,
        body,
        audience,
        ...(audience === "batch" ? { batchId } : {}),
      });
      setMessage(
        result.ok
          ? `Sent in-app to ${result.recipientCount} account${
              result.recipientCount === 1 ? "" : "s"
            }. WhatsApp queued for ${result.whatsappRecipientCount ?? 0} number${
              result.whatsappRecipientCount === 1 ? "" : "s"
            }.`
          : result.error,
      );
      if (result.ok) {
        setTitle("");
        setBody("");
        router.refresh();
      }
    } catch {
      setMessage("Could not confirm the announcement. Refresh the sent list before retrying.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="rounded-card border border-line bg-paper p-4"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        void send();
      }}
    >
      <h2 className="font-display text-[15px] font-semibold">
        Send an announcement
      </h2>
      <p className="mt-1 text-[12.5px] text-ink-3">
        Creates in-app notifications and queues WhatsApp updates to selected
        student contacts and relevant staff. Student updates require active
        communications consent. The local demo captures messages in the mock viewer.
      </p>

      <div className="mt-3 space-y-3">
        <Field id="announcement-title" label="Title">
          {(field) => (
            <Input
              {...field}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={160}
              placeholder="Pool closed on Saturday"
            />
          )}
        </Field>

        <Field id="announcement-message" label="Message">
          {(field) => (
            <Textarea
              {...field}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              maxLength={4000}
              placeholder="Maintenance work means the 7am batch moves to Sunday."
            />
          )}
        </Field>

        <Field id="announcement-audience" label="Audience">
          {(field) => (
            <Select
              {...field}
              value={audience}
              onChange={(e) =>
                setAudience(e.target.value as "all" | "batch" | "parents")
              }
            >
              <option value="all">Everyone — staff and linked accounts</option>
              <option value="batch">
                One {batchLabel.toLowerCase()}&apos;s {memberLabel.toLowerCase()} and{" "}
                {guardianLabel.toLowerCase()}
              </option>
              <option value="parents">
                Parents and {guardianLabel.toLowerCase()} only
              </option>
            </Select>
          )}
        </Field>

        {audience === "batch" ? (
          batches.length === 0 ? (
            <p className="text-[12.5px] text-ink-3">
              No batches exist yet — create one before announcing to a batch.
            </p>
          ) : (
            <Field id="announcement-batch" label={batchLabel}>
              {(field) => (
                <Select
                  {...field}
                  value={batchId}
                  onChange={(e) => setBatchId(e.target.value)}
                >
                  {batches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )
        ) : null}
      </div>

      <Button
        type="submit"
        variant="primary"
        size="md"
        disabled={
          busy ||
          title.trim().length === 0 ||
          body.trim().length === 0 ||
          (audience === "batch" && !batchId)
        }
        className="mt-3"
      >
        {busy ? "Sending…" : "Send announcement"}
      </Button>

      {message ? (
        <p role="status" className="mt-2 text-[12px] text-ink-2">
          {message}
        </p>
      ) : null}
    </form>
  );
}
