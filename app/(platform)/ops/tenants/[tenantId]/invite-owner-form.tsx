"use client";

import { useActionState, useState, useTransition } from "react";
import { useRef, useEffect } from "react";
import {
  inviteOwnerAction,
  type InviteOwnerActionResult,
} from "@/lib/actions/platform-invite-owner";
import {
  issueOwnerLoginLinkAction,
  issueOwnerResetLinkAction,
} from "@/lib/actions/platform-login-link";
import { LinkQr } from "@/components/link-qr";
import { formatDateTimeIST } from "@/lib/time/tz";
import {
  OpsWriteGate,
} from "@/components/ops/ops-display";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";

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

export function InviteOwnerForm({
  tenantId,
  canWrite,
}: {
  tenantId: string;
  /**
   * Resolved on the server from the session role. A viewer sees the
   * panel's explanation and the read-only reason — never the mint
   * controls. The actions still refuse a forged write.
   */
  canWrite: boolean;
}) {
  const [state, formAction, isPending] = useActionState(inviteOwnerAction, {
    kind: "error",
    code: "invalid",
    message: "",
  } as InviteOwnerActionResult);
  const [phone, setPhone] = useState("");
  const [fullName, setFullName] = useState("");
  const [staffType, setStaffType] = useState("");
  const phoneInputRef = useRef<HTMLInputElement>(null);

  // After a successful invite, refocus the input. Done in in
  // effect so the focus moves AFTER the action's revalidation finishes —
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
    <OpsWriteGate
      canWrite={canWrite}
      note={
        <>
          Read-only: this account can browse, not change, platform data. The
          owner&apos;s membership and login link are issued by an administrator.
        </>
      }
    >
      {/* method="post" is pinned by scripts/e2e-platform-form-leak.ts;
          suppress the case-only hydration warning React raises for
          server-action forms (POST vs post). */}
      <form action={formAction} method="post" suppressHydrationWarning className="space-y-3">
        <input type="hidden" name="tenantId" value={tenantId} />
      <p className="text-[13px] text-ink-2">
        Create the owner&apos;s membership for a phone number. Nothing is sent anywhere —
        after inviting, mint a login link below and share it with the owner yourself.
      </p>
      <div className="space-y-2">
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-ink-2">
            Owner name
          </span>
          <Input
            name="fullName"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Priya Iyer"
            autoComplete="name"
            required
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-ink-2">
            Owner phone (+country code)
          </span>
          <Input
            ref={phoneInputRef}
            name="phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+919876543210"
            inputMode="tel"
            autoComplete="tel"
            required
            className="font-mono"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-ink-2">
            Also on the staff roster? (optional)
          </span>
          <Select
            name="staffType"
            value={staffType}
            onChange={(e) => setStaffType(e.target.value)}
          >
            <option value="">— No, owner-only —</option>
            <option value="coach">Yes — also a coach (so they can be assigned to a batch)</option>
            <option value="receptionist">Yes — also a receptionist</option>
            <option value="worker">Yes — also a worker</option>
            <option value="accountant">Yes — also an accountant</option>
          </Select>
        </label>
      </div>
      <div>
        <Button type="submit" variant="primary" size="sm" disabled={isPending}>
          {isPending ? "Inviting…" : "Invite owner"}
        </Button>
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
    </OpsWriteGate>
  );
}

type MintedLink = { url: string; expiresAt: string };

function OwnerLoginLinkPanel({ tenantId, phone }: { tenantId: string; phone: string }) {
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState<MintedLink | null>(null);
  const [resetLink, setResetLink] = useState<MintedLink | null>(null);
  const [copied, setCopied] = useState<"link" | "reset" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function mint(
    fn: () => Promise<Awaited<ReturnType<typeof issueOwnerLoginLinkAction>>>,
    set: (l: MintedLink) => void,
  ) {
    setError(null);
    setCopied(null);
    startTransition(async () => {
      const result = await fn();
      if (result.kind === "error") {
        setError(result.message);
      } else {
        set({
          url: `${window.location.origin}${result.urlPath}`,
          expiresAt: formatDateTimeIST(result.expiresAt),
        });
      }
    });
  }

  async function onCopy(l: MintedLink, which: "link" | "reset") {
    try {
      await navigator.clipboard.writeText(l.url);
      setCopied(which);
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
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => mint(() => issueOwnerLoginLinkAction({ tenantId, phone }), setLink)}
          disabled={pending || phone.trim().length === 0}
          data-testid="owner-login-link-issue"
        >
          {pending ? "Minting…" : "Get login link"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => mint(() => issueOwnerResetLinkAction({ tenantId, phone }), setResetLink)}
          disabled={pending || phone.trim().length === 0}
          data-testid="owner-reset-link-issue"
        >
          Reset owner PIN
        </Button>
      </div>
      <p className="mt-1 text-[11px] text-ink-3">
        A reset link expires in 1 hour and signs the owner out of other devices.
      </p>
      {error ? (
        <p role="alert" className="mt-2 text-[12px] text-ink-2">{error}</p>
      ) : null}
      {link ? (
        <MintedLinkBlock
          kind="login"
          link={link}
          copied={copied === "link"}
          onCopy={() => onCopy(link, "link")}
        />
      ) : null}
      {resetLink ? (
        <MintedLinkBlock
          kind="reset"
          link={resetLink}
          copied={copied === "reset"}
          onCopy={() => onCopy(resetLink, "reset")}
        />
      ) : null}
    </div>
  );
}

function MintedLinkBlock({
  kind,
  link,
  copied,
  onCopy,
}: {
  kind: "login" | "reset";
  link: MintedLink;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="mt-2" data-testid={`owner-${kind}-link-block`}>
      <p className="text-[11px] text-ink-3 break-all font-mono" data-testid={`owner-${kind}-link-url`}>
        {link.url}
      </p>
      <p className="mt-1 text-[11px] text-ink-3">
        Works once, expires {link.expiresAt}.
        {kind === "reset" ? " The owner sets a new PIN when they open it." : ""}
      </p>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={onCopy}
        className="mt-2"
        data-testid={`owner-${kind}-link-copy`}
      >
        {copied ? "Copied" : "Copy link"}
      </Button>
      <div className="mt-3">
        <LinkQr url={link.url} />
      </div>
    </div>
  );
}
