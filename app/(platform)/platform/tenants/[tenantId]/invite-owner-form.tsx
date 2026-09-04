"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inviteOwnerAction } from "@/lib/actions/platform-invite-owner";

// Phase 2.7 — "Invite the owner" client island. Lives on the
// tenant detail page. The form takes a phone number, calls
// inviteOwnerAction, and reflects the result. Empty / error states
// each carry a verb CTA per the design-system rules called out in
// the audit.
//
// The dominant element on this section is the submit button. The
// field layout is single-column. We disable the button while
// pending to avoid double-clicks; the result renders inline below.

export function InviteOwnerForm({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<
    | { kind: "ok"; wasNewUser: boolean; phone: string }
    | { kind: "error"; message: string }
    | null
  >(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus(null);
    if (!phone.trim()) {
      setStatus({ kind: "error", message: "Phone is required." });
      return;
    }
    startTransition(async () => {
      const result = await inviteOwnerAction({ tenantId, phone: phone.trim() });
      if (result.kind === "ok") {
        setStatus({ kind: "ok", wasNewUser: result.wasNewUser, phone });
        setPhone("");
        router.refresh();
        return;
      }
      // result.kind === "error" with a `code` subfield. The codes:
      //   invalid           — surface schema failure (the action's
      //                       safeParse rejected)
      //   tenant_not_found  — race with tenant deletion
      //   owner_role_missing — data fixture issue
      //   already_member    — the user is already on this tenant
      // We surface each with the engine's message, mapping the
      // "already_member" code to a more specific UI string since
      // the operator should look at the roster.
      if (result.code === "already_member") {
        setStatus({
          kind: "error",
          message:
            "This user is already a member of the tenant. Find them in the roster.",
        });
        return;
      }
      setStatus({ kind: "error", message: result.message });
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <p className="text-[13px] text-ink-2">
        Send an invite to a phone number. The owner accepts by
        signing in with the same number; until then their membership
        is in the <span className="font-medium">invited</span> state.
      </p>
      <div className="flex items-end gap-3">
        <label className="block flex-1">
          <span className="block text-[12px] font-medium text-ink-2 mb-1">
            Owner phone (E.164)
          </span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+919876543210"
            inputMode="tel"
            autoComplete="tel"
            className="w-full rounded-ctl border border-line bg-paper px-3 py-2 text-[14px] font-mono text-ink placeholder:text-ink-3 focus:border-[var(--accent)] focus:outline-none"
          />
        </label>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-pill px-4 py-2 text-[13px] font-semibold text-paper bg-[var(--accent)] hover:opacity-90 disabled:opacity-60 transition-colors duration-150"
        >
          {isPending ? "Inviting…" : "Invite owner"}
        </button>
      </div>
      {status?.kind === "ok" ? (
        <p
          role="status"
          className="rounded-ctl border border-line bg-deck px-3 py-2 text-[13px] text-ink-2"
        >
          {status.wasNewUser
            ? "Owner invited — user created, membership pending phone confirmation."
            : "Owner invited — existing user, membership updated."}
        </p>
      ) : null}
      {status?.kind === "error" ? (
        <p
          role="alert"
          className="rounded-ctl border border-line bg-deck px-3 py-2 text-[13px] text-ink-2"
        >
          {status.message}
        </p>
      ) : null}
    </form>
  );
}
