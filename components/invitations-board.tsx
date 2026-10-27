"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, Copy, Loader2, RotateCcw, X } from "lucide-react";
import {
  reactivateInvitationAction,
  revokeInvitationAction,
} from "@/lib/actions/staff-invitations";
import { issueLoginLinkAction } from "@/lib/actions/invite-link";
import { LinkQr } from "@/components/link-qr";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { ListInvitationsRow } from "@/lib/services/staff-invitations";
import { formatDateTimeIST } from "@/lib/time/tz";
import { formatPhoneIN } from "@/lib/phone";

// Phase 3.6 — invitations board. List with state pills, per-row
// revoke + login-link issue. There is no delivery channel yet (no
// SMS, no WhatsApp), so the board never claims anything was sent:
// issuing a link shows the link to copy, with the expiry, and says
// plainly to share it by hand. "Resend reminder" used to sit here
// calling an endpoint that returned { delivered: false } and showed
// nothing -- a button that pretends to send. It is gone; the link
// panel below is the honest replacement, for invited rows (first
// login) and active rows (re-login when a session dies) alike.
//
// F4 audit correction (Sep 2026): status pills used to colour
// "invited" with the warn semantic token and "active" with the
// good semantic token. Those are reserved for money and
// attendance state (DESIGN.md §1.1). Invitation state is neither
// — it is "has this staff member accepted the invite?", a binary
// lifecycle. The pill text ("Invited" / "Active") is the source
// of truth; the colour is now neutral ink. Same fix as the F4
// audit applied to other recently-added surfaces (onboarding-
// checklist, branding-form, terminology-form, staff-invite-form).

const STATUS_LABEL: Record<ListInvitationsRow["status"], string> = {
  invited: "Invited",
  active: "Active",
  revoked: "Revoked",
};

export function InvitationsBoard({ rows }: { rows: ListInvitationsRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-ctl border border-line bg-paper">
        {/* Owner redesign (C2) — the shared empty state, so every list
            in the owner surface has one empty shape. */}
        <EmptyState
          title="No staff on the roster"
          body="Active and pending staff appear here. Add a coach or receptionist to start."
          action={{
            label: "Invite your first staff member",
            href: "/owner/staff/invitations/new",
          }}
        />
      </div>
    );
  }

  return (
    <ul data-testid="invitations-list">
      {rows.map((r) => (
        <InvitationRow key={r.membershipId} row={r} />
      ))}
    </ul>
  );
}

function InvitationRow({ row }: { row: ListInvitationsRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"revoke" | "link" | "reactivate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmingReactivate, setConfirmingReactivate] = useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);

  const scopeLabel =
    row.locationNames.length === 0
      ? "all locations in this academy"
      : row.locationNames.join(", ");

  function onReactivate() {
    if (pending || busy) return;
    setError(null);
    setBusy("reactivate");
    startTransition(async () => {
      const result = await reactivateInvitationAction(row.membershipId);
      if (result.kind === "error") {
        setError(result.message);
      } else {
        setConfirmingReactivate(false);
        setLink({
          url: `${window.location.origin}${result.urlPath}`,
          expiresAt: formatDateTimeIST(result.expiresAt),
        });
        // Server-component re-render keeps the status pill aligned;
        // the fresh link above stays visible (client state survives
        // refresh).
        router.refresh();
      }
      setBusy(null);
    });
  }

  function onRevoke() {
    if (pending || busy) return;
    setError(null);
    setBusy("revoke");
    startTransition(async () => {
      const result = await revokeInvitationAction(row.membershipId);
      if (result.kind === "error") {
        // The confirmation panel stays open so the owner can retry.
        setError(result.message);
      } else {
        setConfirmingRevoke(false);
        setLink(null);
        // Server-component re-render keeps the row and the roster
        // aligned with the persisted revocation.
        router.refresh();
      }
      setBusy(null);
    });
  }

  function onIssueLink() {
    if (pending || busy) return;
    setError(null);
    setBusy("link");
    setCopied(false);
    startTransition(async () => {
      const result = await issueLoginLinkAction(row.membershipId);
      if (result.kind === "error") {
        setError(result.message);
      } else {
        setLink({
          url: `${window.location.origin}${result.urlPath}`,
          expiresAt: formatDateTimeIST(result.expiresAt),
        });
      }
      setBusy(null);
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
    <li className="bg-paper border border-line rounded-ctl mb-2 last:mb-0 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-mono text-[13.5px] text-ink truncate">{formatPhoneIN(row.phone)}</p>
        {/* Owner redesign (C2) — the shared status pill. The state
            stays NEUTRAL (F4: invitation state is neither money nor
            attendance), but the pill shape is now the shared one. */}
        <StatusBadge tone="neutral">{STATUS_LABEL[row.status]}</StatusBadge>
      </div>
      <p className="text-[12.5px] text-ink-3 mt-1">
        {row.roleKey}
        {row.locationNames.length === 0
          ? " · all locations"
          : ` · ${row.locationNames.join(", ")}`}
      </p>
      {error ? (
        <p className="mt-2 text-[12.5px] text-ink-3" role="alert">{error}</p>
      ) : null}
      {row.status === "invited" ? (
        <p className="mt-2 text-[12px] text-ink-3">
          They sign in with the login link below — the membership flips to &quot;active&quot; on first use.
          Invitations are queued for WhatsApp. Creating a login link also queues
          a private link to the registered number. You can still copy and share it yourself.
        </p>
      ) : null}
      {link ? (
        <div className="mt-2 rounded-ctl border border-line bg-deck p-3">
          <p className="text-[11px] text-ink-3 break-all font-mono">{link.url}</p>
          <p className="mt-1 text-[11px] text-ink-3">
            Works once, expires {link.expiresAt}. Anyone holding it can sign in as {row.roleKey} — send it
            directly to the right person.
          </p>
          <button
            type="button"
            onClick={onCopy}
            className="mt-2 inline-flex min-h-11 items-center justify-center rounded-pill px-3 py-2 text-[13px] font-medium bg-paper border border-line text-ink-2 gap-1.5"
            data-testid={`copy-link-${row.membershipId}`}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "Copied" : "Copy link"}
          </button>
          <div className="mt-3">
            <LinkQr url={link.url} />
          </div>
        </div>
      ) : null}
      <div className="mt-3 flex gap-2">
        {row.status === "invited" || row.status === "active" ? (
          <button
            type="button"
            onClick={onIssueLink}
            disabled={pending}
            className="inline-flex min-h-11 items-center justify-center rounded-pill px-3 py-2 text-[13px] font-medium bg-deck text-ink-2 disabled:opacity-50 gap-1.5"
            data-testid={`issue-link-${row.membershipId}`}
          >
            {busy === "link" ? <Loader2 size={13} className="animate-spin" /> : <ChevronRight size={13} />}
            {row.status === "invited" ? "Get login link" : "New login link"}
          </button>
        ) : null}
        {row.status === "active" || row.status === "invited" ? (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setConfirmingRevoke(true);
            }}
            disabled={pending}
            className="inline-flex min-h-11 items-center justify-center rounded-pill px-3 py-2 text-[13px] font-medium border border-line text-ink-2 disabled:opacity-50 gap-1.5"
            data-testid={`revoke-${row.membershipId}`}
          >
            {busy === "revoke" ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
            Revoke
          </button>
        ) : null}
      {row.status === "revoked" ? (
        confirmingReactivate ? (
          <div className="mt-2 w-full rounded-ctl border border-line bg-deck p-3">
            <p className="text-[13px] font-medium">
              Restore access for {formatPhoneIN(row.phone)}?
            </p>
            <p className="mt-1 text-[12px] text-ink-3 leading-snug">
              They were signed in as {row.roleKey} with access to {scopeLabel}.
              Old invitation and login links stay invalid. A fresh
              single-use link will be issued and shown here.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={onReactivate}
                disabled={pending}
                className="inline-flex min-h-11 items-center justify-center rounded-pill px-4 text-[13px] font-medium bg-[var(--accent-strong)] text-paper disabled:opacity-50"
                data-testid={`reactivate-confirm-${row.membershipId}`}
              >
                {busy === "reactivate" ? "Restoring…" : "Restore access"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingReactivate(false)}
                disabled={pending}
                className="inline-flex min-h-11 items-center justify-center rounded-pill px-4 text-[13px] font-medium bg-paper border border-line text-ink-2"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setConfirmingReactivate(true);
            }}
            disabled={pending}
            className="inline-flex min-h-11 items-center justify-center rounded-pill px-3 py-2 text-[13px] font-medium bg-deck text-ink-2 disabled:opacity-50 gap-1.5"
            data-testid={`reactivate-${row.membershipId}`}
          >
            <RotateCcw size={13} />
            Reactivate
          </button>
        )
      ) : null}
      </div>

      {confirmingRevoke ? (
        <div className="mt-2 rounded-ctl border border-line bg-deck p-3">
          <p className="text-[13px] font-medium">
            Revoke access for {formatPhoneIN(row.phone)}?
          </p>
          <p className="mt-1 text-[12px] text-ink-3 leading-snug">
            They act as {row.roleKey} with access to {scopeLabel}. Revoking
            removes that access immediately: pending and existing login links
            stop working, and any signed-in session can no longer use this
            academy. The staff directory record is kept, and you can restore
            access later.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={onRevoke}
              disabled={pending || busy !== null}
              className="inline-flex min-h-11 items-center justify-center rounded-pill px-4 text-[13px] font-medium border border-line bg-paper text-ink-2 disabled:opacity-50"
              data-testid={`revoke-confirm-${row.membershipId}`}
            >
              {busy === "revoke" ? "Revoking…" : "Revoke access"}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmingRevoke(false);
                setError(null);
              }}
              disabled={pending || busy !== null}
              className="inline-flex min-h-11 items-center justify-center rounded-pill px-4 text-[13px] font-medium bg-paper border border-line text-ink-2"
            >
              Keep access
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
