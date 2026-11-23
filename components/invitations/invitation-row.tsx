"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, Copy, Loader2, RotateCcw, X } from "lucide-react";
import { reactivateInvitationAction, revokeInvitationAction } from "@/lib/actions/staff-invitations";
import { issueLoginLinkAction } from "@/lib/actions/invite-link";
import { LinkQr } from "@/components/link-qr";
import { Input } from "@/components/ui/Input";
import { Dialog } from "@/components/ui/Dialog";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { formatDateTimeIST } from "@/lib/time/tz";
import { formatPhoneIN } from "@/lib/phone";
import type { ListInvitationsRow } from "@/lib/services/staff-invitations";

export function InvitationRow({ row, roleName, statusName, compact }: {
  row: ListInvitationsRow;
  roleName: string;
  statusName: string;
  compact: boolean;
}) {
  const router = useRouter();
  const name = row.fullName?.trim();
  const phone = formatPhoneIN(row.phone);
  const nameIsPhone = !!name && /^[+\d\s().-]+$/.test(name) && name.replace(/\D/g, "") === row.phone.replace(/\D/g, "");
  const displayName = name && !nameIsPhone ? name : null;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"revoke" | "link" | "reactivate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [confirmingReactivate, setConfirmingReactivate] = useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);

  const scopeLabel = row.allLocations
    ? "All clubs, including future clubs"
    : row.locationNames.length > 0
      ? row.locationNames.join(", ")
      : "No clubs assigned";

  function onReactivate() {
    if (pending || busy) return;
    setError(null);
    setBusy("reactivate");
    startTransition(async () => {
      const result = await reactivateInvitationAction(row.membershipId);
      if (result.kind === "error") {
        setError(result.message);
        if (result.code === "issue_failed" || result.code === "uncertain") {
          setConfirmingReactivate(false);
          router.refresh();
        }
      } else {
        setConfirmingReactivate(false);
        setCopyFailed(false);
        setShowLink(false);
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
        setCopyFailed(false);
        setShowLink(false);
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
    setCopyFailed(false);
    setShowLink(false);
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
      setCopyFailed(false);
      setShowLink(false);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  }

  const actions = (
    <div className={compact ? "flex flex-wrap gap-2" : "mt-2 flex flex-wrap gap-2 lg:mt-0 lg:justify-end"}>
      {row.status === "invited" || row.status === "active" ? (
        <button
          type="button"
          onClick={onIssueLink}
          disabled={pending}
          className="inline-flex min-h-11 items-center justify-center rounded-pill px-3 py-2 text-[13px] font-medium bg-deck text-ink-2 disabled:opacity-50 gap-1.5"
          data-testid={`issue-link-${row.membershipId}`}
        >
          {busy === "link" ? <Loader2 size={13} className="animate-spin" /> : <ChevronRight size={13} />}
          {row.status === "invited" ? "Generate sign-in link" : "New login link"}
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
      ) : null}
    </div>
  );
  const feedback = (
    <>
      {error ? (
        <p className="mt-2 text-[12.5px] text-ink-3 lg:col-span-full" role="alert">{error}</p>
      ) : null}
      {row.status === "invited" ? (
        <p className="mt-2 text-[12px] text-ink-3 lg:col-span-full">
          Generate and share the private link directly with this person. Their status changes to Active when they sign in.
        </p>
      ) : null}
      {link ? (
        <div className="mt-2 rounded-ctl border border-line bg-deck p-3 lg:col-span-full">
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
          {copyFailed ? (
            <div className="mt-2">
              <p role="status" className="text-[12px] text-ink-3">Copy is unavailable. Scan the QR or show the link to copy it manually.</p>
              <button type="button" onClick={() => setShowLink(!showLink)} className="mt-2 min-h-11 rounded-pill border border-line bg-paper px-3 text-[13px] text-ink-2" aria-expanded={showLink}>
                {showLink ? "Hide link" : "Show link to copy"}
              </button>
              {showLink ? <Input aria-label="Invitation link" readOnly value={link.url} onFocus={(event) => event.currentTarget.select()} className="mt-2" /> : null}
            </div>
          ) : null}
          <div className="mt-3">
            <LinkQr url={link.url} />
          </div>
        </div>
      ) : null}

      {row.status === "revoked" && confirmingReactivate ? (
        <div className="mt-2 w-full rounded-ctl border border-line bg-deck p-3 lg:col-span-full">
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
      ) : null}

      {confirmingRevoke ? (
        <div className="mt-2 rounded-ctl border border-line bg-deck p-3 lg:col-span-full">
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
    </>
  );

  const identity = (
    <div className="min-w-0 flex-1">
      <p className="break-words text-[14px] font-medium text-ink">{displayName ?? phone}</p>
      {displayName ? <p className="mt-0.5 font-mono text-[12px] text-ink-3">{phone}</p> : null}
    </div>
  );

  function setDetails(open: boolean) {
    if (!open) {
      setConfirmingRevoke(false);
      setConfirmingReactivate(false);
      setShowLink(false);
    }
    setDetailsOpen(open);
  }

  if (compact) {
    return (
      <li className="flex min-h-16 items-center gap-3 px-4 py-2">
        {identity}
        <button type="button" aria-label={`Invitation details for ${displayName ? `${displayName}, ` : ""}${phone}`}
          aria-haspopup="dialog" aria-expanded={detailsOpen} onClick={() => setDetails(true)}
          className="grid size-11 shrink-0 place-items-center rounded-ctl border border-line bg-paper text-[var(--accent-ink)] hover:bg-deck">
          <OwnerIcon name="more" size={20} />
        </button>
        <Dialog open={detailsOpen} onOpenChange={setDetails}
          title={(detailsOpen && displayName) || "Invitation details"} description={detailsOpen ? phone : undefined}>
          {detailsOpen ? <div className="space-y-4">
            <dl className="grid gap-2 rounded-ctl border border-line bg-deck px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-x-3"><dt className="text-ink-2">Role</dt><dd className="font-medium">{roleName}</dd></div>
              <div className="flex flex-wrap items-center justify-between gap-x-3"><dt className="text-ink-2">Status</dt><dd><StatusBadge tone="neutral">{statusName}</StatusBadge></dd></div>
              <div className="grid gap-0.5"><dt className="text-ink-2">Club access</dt><dd className="break-words font-medium">{scopeLabel}</dd></div>
            </dl>
            {actions}
            {feedback}
          </div> : null}
        </Dialog>
      </li>
    );
  }

  return (
    <li className="p-4 lg:grid lg:grid-cols-[minmax(0,1.4fr)_minmax(0,.8fr)_minmax(0,1fr)_auto_minmax(0,1.2fr)] lg:items-start lg:gap-3">
      {identity}
      <p className="mt-1 text-[12.5px] text-ink-2 lg:mt-0">
        <span className="mr-1 text-[11px] uppercase tracking-[0.08em] text-ink-3 lg:hidden">Role</span>
        {roleName}
      </p>
      <p className="mt-1 text-[12.5px] text-ink-2 lg:mt-0">
        <span className="mr-1 text-[11px] uppercase tracking-[0.08em] text-ink-3 lg:hidden">Club access</span>
        {scopeLabel}
      </p>
      <span className="mt-1 flex lg:mt-0"><StatusBadge tone="neutral">{statusName}</StatusBadge></span>
      {actions}
      {feedback}
    </li>
  );
}
