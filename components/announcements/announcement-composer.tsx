"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendAnnouncementAction } from "@/lib/actions/announcements";

// U-06 — the announcement composer. In-app delivery only in Release
// 1: the WhatsApp provider is the C-40a mock and no send is
// attempted, which the copy below states so an owner is never left
// believing a WhatsApp message went out.

const inputClass =
  "w-full min-h-11 rounded-ctl border border-line bg-paper px-3 py-2 text-[16px] text-ink focus:border-[var(--accent-strong)] focus:outline-none";

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

  return (
    <section className="rounded-card border border-line bg-paper p-4">
      <h2 className="font-display text-[15px] font-semibold">
        Send an announcement
      </h2>
      <p className="mt-1 text-[12.5px] text-ink-3">
        Delivered in-app, to every account the audience resolves to.
        WhatsApp is not connected in this release — nothing is sent
        through it.
      </p>

      <div className="mt-3 space-y-3">
        <label className="block">
          <span className="mb-0.5 block text-[11px] text-ink-3">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={160}
            className={inputClass}
            placeholder="Pool closed on Saturday"
          />
        </label>

        <label className="block">
          <span className="mb-0.5 block text-[11px] text-ink-3">Message</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            maxLength={4000}
            className={inputClass}
            placeholder="Maintenance work means the 7am batch moves to Sunday."
          />
        </label>

        <label className="block">
          <span className="mb-0.5 block text-[11px] text-ink-3">Audience</span>
          <select
            value={audience}
            onChange={(e) =>
              setAudience(e.target.value as "all" | "batch" | "parents")
            }
            className={inputClass}
          >
            <option value="all">Everyone — staff and linked accounts</option>
            <option value="batch">
              One {batchLabel.toLowerCase()}&apos;s {memberLabel.toLowerCase()} and{" "}
              {guardianLabel.toLowerCase()}
            </option>
            <option value="parents">
              Parents and {guardianLabel.toLowerCase()} only
            </option>
          </select>
        </label>

        {audience === "batch" ? (
          batches.length === 0 ? (
            <p className="text-[12.5px] text-ink-3">
              No batches exist yet — create one before announcing to a batch.
            </p>
          ) : (
            <label className="block">
              <span className="mb-0.5 block text-[11px] text-ink-3">
                {batchLabel}
              </span>
              <select
                value={batchId}
                onChange={(e) => setBatchId(e.target.value)}
                className={inputClass}
              >
                {batches.map((batch) => (
                  <option key={batch.id} value={batch.id}>
                    {batch.name}
                  </option>
                ))}
              </select>
            </label>
          )
        ) : null}
      </div>

      <button
        type="button"
        disabled={
          busy ||
          title.trim().length === 0 ||
          body.trim().length === 0 ||
          (audience === "batch" && !batchId)
        }
        onClick={() => {
          setBusy(true);
          setMessage(null);
          void (async () => {
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
                  }.`
                : result.error,
            );
            if (result.ok) {
              setTitle("");
              setBody("");
              router.refresh();
            }
            setBusy(false);
          })();
        }}
        className="mt-3 min-h-[44px] rounded-pill bg-[var(--accent-strong)] px-5 text-[13px] font-semibold text-paper disabled:opacity-60"
      >
        {busy ? "Sending…" : "Send in-app"}
      </button>

      {message ? (
        <p role="status" className="mt-2 text-[12px] text-ink-2">
          {message}
        </p>
      ) : null}
    </section>
  );
}
