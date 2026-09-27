"use client";

import { useState } from "react";
import { issueTenantOwnerResetLinkAction } from "@/lib/actions/tenant-owner-reset";
import type { OwnerMembershipRow } from "@/lib/services/owner-reset";

// PR2-C4 — co-owner recovery. One button per owner mints the same
// owner-only reset link the platform operator used to mint; nothing is
// delivered automatically, so the link is shown to copy and share over
// whatever channel the owners already use. The link expires in an hour
// and revokes the owner's other sessions when redeemed.

export function OwnerResetLinks({ owners }: { owners: OwnerMembershipRow[] }) {
  const [links, setLinks] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function issue(membershipId: string) {
    setBusyId(membershipId);
    setError(null);
    void (async () => {
      try {
        const result = await issueTenantOwnerResetLinkAction({ membershipId });
        if (result.kind !== "ok") {
          setError(result.message);
          return;
        }
        setLinks((current) => ({
          ...current,
          [membershipId]: `${window.location.origin}${result.urlPath}`,
        }));
      } catch {
        setError("The reset link could not be created. Try again.");
      } finally {
        setBusyId(null);
      }
    })();
  }

  return (
    <section className="mt-8">
      <h2 className="font-display text-[15px] font-semibold">Owner access</h2>
      <p className="mt-1 text-[12.5px] text-ink-3">
        If an owner is locked out, create a one-hour reset link and send it to
        them yourself. Redeeming it sets a new PIN and signs out their other
        devices.
      </p>

      <ul className="mt-3 space-y-2">
        {owners.map((owner) => (
          <li
            key={owner.membershipId}
            className="rounded-card border border-line bg-paper px-3.5 py-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[14px] text-ink">
                {owner.fullName ?? "Owner"}
                <span className="ml-2 font-mono text-[12px] text-ink-3">
                  {owner.phone}
                </span>
              </span>
              <button
                type="button"
                onClick={() => issue(owner.membershipId)}
                disabled={busyId === owner.membershipId}
                className="inline-flex min-h-11 items-center justify-center rounded-pill border border-line px-3 py-1.5 text-[12.5px] font-medium text-ink-2 hover:text-ink disabled:opacity-50"
              >
                {busyId === owner.membershipId
                  ? "Creating…"
                  : "Create reset link"}
              </button>
            </div>
            {links[owner.membershipId] ? (
              <p className="mt-2 break-all rounded-ctl bg-deck px-2.5 py-2 font-mono text-[11.5px] text-ink-2">
                {links[owner.membershipId]}
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      {error ? (
        <p role="alert" className="mt-2 text-[12.5px] text-ink-2">
          {error}
        </p>
      ) : null}
    </section>
  );
}
