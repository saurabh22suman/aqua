"use client";

import { useActionState, useState, useTransition } from "react";
import { useRef, useEffect } from "react";
import {
  inviteOwnerAction,
  type InviteOwnerActionResult,
} from "@/lib/actions/platform-invite-owner";
import { issueOwnerLoginLinkAction } from "@/lib/actions/platform-login-link";

// Phase 2.7 — "Invite the owner" client island. Lives on the
// tenant detail page. The form takes a phone number, calls
// inviteOwnerAction, and reflects the result. Empty / error states
// each carry a verb CTA per the design-system rules called out in
// the audit.
//
// There is no delivery channel (no SMS, no WhatsApp), so neither
// the invite nor anything here claims to send one. After inviting
// -- or for an existing owner who is locked out, since a logged-
// out sole owner cannot mint their own link -- the operator mints
// a single-use login link below and shares it over whatever human
// channel they already have with the owner (call, email).
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
  const [phone, setPhone] = useState("");
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

  return (
    <form action={formAction} method="post" className="space-y-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      <p className="text-[13px] text-ink-2">
        Create the owner&apos;s membership for a phone number. Nothing is sent anywhere —
        after inviting, mint a login link below and share it with the owner yourself.
      </p>
      <div className="flex items-end gap-3">
        <label className="block flex-1">
          <span className="block text-[12px] font-medium text-ink-2 mb-1">
            Owner phone (E.164)
          </span>
          <input
            ref={phoneInputRef}
            name="phone"
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
      {ok ? (
        <p
          role="status"
          className="rounded-ctl border border-line bg-deck px-3 py-2 text-[13px] text-ink-2"
        >
          {ok.wasNewUser
            ? "Owner membership created."
            : "Owner membership already existed — updated."}
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
      <OwnerLoginLinkPanel tenantId={tenantId} phone={phone} />
    </form>
  );
}

function OwnerLoginLinkPanel({ tenantId, phone }: { tenantId: string; phone: string }) {
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onIssue() {
    setError(null);
    setCopied(false);
    startTransition(async () => {
      const result = await issueOwnerLoginLinkAction({ tenantId, phone });
      if (result.kind === "error") {
        setError(result.message);
      } else {
        setLink({
          url: `${window.location.origin}${result.urlPath}`,
          expiresAt: result.expiresAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        });
      }
    });
  }

  async function onCopy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      setError("Copy failed — long-press the link and copy it by hand.");
    }
  }

  return (
    <div className="rounded-ctl border border-line bg-deck px-3 py-3">
      <p className="text-[13px] font-medium text-ink-2">Owner login link</p>
      <p className="mt-1 text-[12px] text-ink-3">
        Single-use, works for the number above. Mint it and share it with the owner yourself —
        this is also how a locked-out sole owner gets back in.
      </p>
      <button
        type="button"
        onClick={onIssue}
        disabled={pending || phone.trim().length === 0}
        className="mt-2 rounded-pill px-4 py-2 text-[13px] font-semibold text-paper bg-[var(--accent)] hover:opacity-90 disabled:opacity-60"
        data-testid="owner-login-link-issue"
      >
        {pending ? "Minting…" : "Get login link"}
      </button>
      {error ? (
        <p role="alert" className="mt-2 text-[12px] text-ink-2">{error}</p>
      ) : null}
      {link ? (
        <div className="mt-2">
          <p className="text-[11px] text-ink-3 break-all font-mono" data-testid="owner-login-link-url">
            {link.url}
          </p>
          <p className="mt-1 text-[11px] text-ink-3">Works once, expires {link.expiresAt}.</p>
          <button
            type="button"
            onClick={onCopy}
            className="mt-2 rounded-pill px-3 py-1.5 text-[12px] font-medium bg-paper border border-line text-ink-2"
            data-testid="owner-login-link-copy"
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
