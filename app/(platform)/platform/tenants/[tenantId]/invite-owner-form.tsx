"use client";

import { useActionState } from "react";
import { useRef, useEffect } from "react";
import {
  inviteOwnerAction,
  type InviteOwnerActionResult,
} from "@/lib/actions/platform-invite-owner";

// Phase 2.7 — "Invite the owner" client island. Lives on the
// tenant detail page. The form takes a phone number, calls
// inviteOwnerAction, and reflects the result. Empty / error states
// each carry a verb CTA per the design-system rules called out in
// the audit.
//
// H1 — pre-hydration submit goes to the server action endpoint via
// POST; the phone never lands in the URL as a query string. The
// tenantId comes through as a hidden input so the server action can
// re-validate it against its zod schema (defends against a tampered
// field addressing a different tenant).

export function InviteOwnerForm({ tenantId }: { tenantId: string }) {
  const [state, formAction, isPending] = useActionState(inviteOwnerAction, {
    kind: "error",
    code: "invalid",
    message: "",
  } as InviteOwnerActionResult);
  const phoneInputRef = useRef<HTMLInputElement>(null);

  // After a successful invite, refocus the input. Done in an effect
  // so the focus moves AFTER the action's revalidation finishes —
  // focusing too early lands the cursor on the input before React
  // has cleared the value.
  useEffect(() => {
    if (state && "kind" in state && state.kind === "ok") {
      phoneInputRef.current?.focus();
    }
  }, [state]);

  const status = state && "kind" in state ? state : null;
  const ok = status?.kind === "ok" ? status : null;
  const err = status?.kind === "error" ? status.message : null;
  // The success state carries the canonical phone the server saw
  // (post-trim). Use it in the echo message.
  const submittedPhone =
    state && "kind" in state && state.kind === "ok" ? "" : null;

  return (
    <form action={formAction} method="post" className="space-y-3">
      <input type="hidden" name="tenantId" value={tenantId} />
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
            ref={phoneInputRef}
            name="phone"
            placeholder="+919876543210"
            inputMode="tel"
            autoComplete="tel"
            defaultValue=""
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
      {ok ? (
        <p
          role="status"
          className="rounded-ctl border border-line bg-deck px-3 py-2 text-[13px] text-ink-2"
        >
          {ok.wasNewUser
            ? "Owner invited — user created, membership pending phone confirmation."
            : "Owner invited — existing user, membership updated."}
          {submittedPhone ? (
            <>
              {" "}
              <span className="font-mono text-ink-3">
                ({submittedPhone})
              </span>
            </>
          ) : null}
        </p>
      ) : null}
      {err ? (
        <p
          role="alert"
          className="rounded-ctl border border-line bg-deck px-3 py-2 text-[13px] text-ink-2"
        >
          {err}
        </p>
      ) : null}
    </form>
  );
}