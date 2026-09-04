"use client";

import { useState } from "react";
import { Check, Copy, Eye, Link2 } from "lucide-react";
import { issueParentLinkAction } from "@/lib/actions/parent-link";

// C-45 — owner-side control to mint a parent-page link for the
// member whose detail page this lives on. The link is what a parent
// opens in a browser; the button shows it after generation. Copy
// puts the URL on the clipboard. There is no list of past links —
// each press mints a fresh signed token; the old one is still valid
// until its 7-day expiry (which is fine — parents may have shared
// older links; re-issuing doesn't invalidate them).

export function ParentLinkPanel({
  memberId,
  memberName,
  primaryGuardianName,
}: {
  memberId: string;
  memberName: string;
  primaryGuardianName: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function mint() {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const res = await issueParentLinkAction({ memberId });
      if (res.kind === "ok") {
        setUrl(res.url);
        setExpiresAt(res.expiresAt);
      } else {
        setError(res.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!url) return;
    const absolute =
      typeof window !== "undefined" ? `${window.location.origin}${url}` : url;
    try {
      await navigator.clipboard.writeText(absolute);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Older browsers, or sandbox restrictions. Fall back to a
      // select-and-copy via a hidden input.
      const input = document.createElement("input");
      input.value = absolute;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <div
      className="mt-4 rounded-card border border-line bg-paper p-3.5"
      data-testid="parent-link-panel"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[12px] text-ink-3">Parent link</p>
          <p className="mt-0.5 text-[13px] text-ink">
            A 7-day read-only page for{" "}
            <span className="font-medium">{primaryGuardianName ?? memberName}</span>
            {" —"} next session, this month&apos;s attendance, recent history.
            Zero JavaScript on the page itself.
          </p>
        </div>
        {!open ? (
          <button
            type="button"
            onClick={() => {
              setOpen(true);
              if (!url) void mint();
            }}
            className="flex-none rounded-ctl border border-line bg-deck px-3 py-2 text-[13px] font-medium text-ink-2"
            data-testid="parent-link-open"
          >
            <Eye size={14} className="inline-block mr-1" />
            Get link
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="mt-3 space-y-2">
          {busy ? (
            <p className="text-[12.5px] text-ink-3">Generating link…</p>
          ) : error ? (
            <p className="text-[12.5px] text-ink-3" role="alert">
              {error}
            </p>
          ) : url ? (
            <>
              <div className="flex items-center gap-2">
                <code
                  className="flex-1 min-w-0 truncate rounded-ctl bg-deck px-3 py-2 font-mono text-[12px] text-ink"
                  data-testid="parent-link-url"
                >
                  {typeof window !== "undefined"
                    ? `${window.location.origin}${url}`
                    : url}
                </code>
                <button
                  type="button"
                  onClick={copyLink}
                  className="flex-none rounded-ctl border border-line bg-paper px-2.5 py-2 text-[12px]"
                  aria-label="Copy link"
                  data-testid="parent-link-copy"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener"
                  className="flex-none rounded-ctl bg-[var(--accent)] px-3 py-2 text-[12.5px] font-medium text-paper"
                  data-testid="parent-link-open-tab"
                >
                  <Link2 size={14} className="inline-block mr-1" />
                  Open
                </a>
              </div>
              <p className="text-[11px] text-ink-3">
                Valid until{" "}
                {expiresAt
                  ? new Date(expiresAt).toLocaleString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "—"}
                . Anyone with the URL can view the page until then.
              </p>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
