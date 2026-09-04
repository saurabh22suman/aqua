"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ChevronRight, Loader2, RotateCcw, X } from "lucide-react";
import {
  revokeInvitationAction,
  resendInvitationAction,
} from "@/lib/actions/staff-invitations";
import type { ListInvitationsRow } from "@/lib/services/staff-invitations";

// Phase 3.6 — invitations board. List with state pills, per-
// row revoke + resend. Resend is a no-op until the messaging
// chain ships; the row tells the user that explicitly rather
// than pretending.
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
  const [busy, setBusy] = useState<"revoke" | "resend" | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  function onResend() {
    setError(null);
    setBusy("resend");
    startTransition(async () => {
      const result = await resendInvitationAction(row.membershipId);
      if (result.kind === "error") {
        setError(result.message);
      }
      setBusy(null);
    });
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
          They sign in with that phone on the staff surface — the membership flips to &quot;active&quot; on first OTP.
        </p>
      ) : null}
      <div className="mt-3 flex gap-2">
        {row.status === "invited" ? (
          <button
            type="button"
            onClick={onResend}
            disabled={pending}
            className="rounded-pill px-3 py-2 text-[13px] font-medium bg-deck text-ink-2 disabled:opacity-50 flex items-center gap-1.5"
            data-testid={`resend-${row.membershipId}`}
          >
            {busy === "resend" ? <Loader2 size={13} className="animate-spin" /> : <ChevronRight size={13} />}
            Resend reminder
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
