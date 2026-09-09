"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, ChevronRight, Copy, Loader2, RotateCcw, X } from "lucide-react";
import {
  revokeInvitationAction,
} from "@/lib/actions/staff-invitations";
import { issueLoginLinkAction } from "@/lib/actions/invite-link";
import type { ListInvitationsRow } from "@/lib/services/staff-invitations";

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

const STATUS_TONE: Record<ListInvitationsRow["status"], string> = {
  invited: "bg-deck text-ink-2",
  active: "bg-deck text-ink-2",
  revoked: "bg-deck text-ink-3",
};

export function InvitationsBoard({ rows }: { rows: ListInvitationsRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-ctl border border-line bg-paper px-5 py-10 text-center">
        <p className="text-[15px] font-medium">No staff on the roster</p>
        <p className="mt-1 text-[13px] text-ink-3">
          Active and pending staff appear here. Add a coach or receptionist to start.
        </p>
        <Link
          href="/owner/staff/invitations/new"
          className="mt-5 inline-flex items-center justify-center rounded-pill px-5 py-3 text-[14.5px] font-semibold text-paper bg-[var(--accent)]"
        >
          Invite your first staff member
        </Link>
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
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"revoke" | "link" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  function onRevoke() {
    setError(null);
    setBusy("revoke");
    startTransition(async () => {
      const result = await revokeInvitationAction(row.membershipId);
      if (result.kind === "error") {
        setError(result.message);
      } else {
        // Server-component re-render: a hard refresh keeps the
        // list aligned with the audit row.
        window.location.reload();
      }
      setBusy(null);
    });
  }

  function onIssueLink() {
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
          expiresAt: result.expiresAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
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
        <p className="font-mono text-[13.5px] text-ink truncate">{row.phone}</p>
        <span className={`text-[11px] font-medium px-2.5 py-1 rounded-pill ${STATUS_TONE[row.status]}`}>
          {STATUS_LABEL[row.status]}
        </span>
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
          Nothing is sent by SMS or WhatsApp; copy the link and share it yourself.
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
            className="mt-2 rounded-pill px-3 py-2 text-[13px] font-medium bg-paper border border-line text-ink-2 flex items-center gap-1.5"
            data-testid={`copy-link-${row.membershipId}`}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      ) : null}
      <div className="mt-3 flex gap-2">
        {row.status === "invited" || row.status === "active" ? (
          <button
            type="button"
            onClick={onIssueLink}
            disabled={pending}
            className="rounded-pill px-3 py-2 text-[13px] font-medium bg-deck text-ink-2 disabled:opacity-50 flex items-center gap-1.5"
            data-testid={`issue-link-${row.membershipId}`}
          >
            {busy === "link" ? <Loader2 size={13} className="animate-spin" /> : <ChevronRight size={13} />}
            {row.status === "invited" ? "Get login link" : "New login link"}
          </button>
        ) : null}
        {row.status === "active" || row.status === "invited" ? (
          <button
            type="button"
            onClick={onRevoke}
            disabled={pending}
            className="rounded-pill px-3 py-2 text-[13px] font-medium border border-line text-ink-2 disabled:opacity-50 flex items-center gap-1.5"
            data-testid={`revoke-${row.membershipId}`}
          >
            {busy === "revoke" ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
            Revoke
          </button>
        ) : null}
        {row.status === "revoked" ? (
          <span className="text-[12px] text-ink-3 flex items-center gap-1.5">
            <RotateCcw size={12} /> Revoked
          </span>
        ) : null}
      </div>
    </li>
  );
}
