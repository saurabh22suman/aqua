import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { requireDefaultCtx, sessionExists } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import { resolvePremisesCheckIn } from "@/lib/services/premises-check-in";
import { PremisesCheckInButton } from "@/components/premises-check-in-button";
import { formatTimeIST } from "@/lib/time/tz";

// V-25 — the page the premises QR opens. Deliberately outside the
// role route groups: a scan can come from any staff surface (coach,
// reception, worker), and the surface frame is not what authorises
// this — the session is. Authorization: any authenticated tenant
// member with staff.self, plus a token that names their own tenant
// (resolvePremisesCheckIn).
//
// The QR is public (it hangs on a wall), so the states are honest:
// no session → sign in first; bad/foreign token → not valid; no staff
// record → nothing to check in.

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-md px-5 pt-16 pb-8">
      <h1 className="font-display text-[19px] font-semibold">{title}</h1>
      {children}
    </main>
  );
}

export default async function PremisesCheckInPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!(await sessionExists())) {
    return (
      <Shell title="Sign in first">
        <p className="mt-2 text-[13.5px] text-ink-3">
          Check-in needs your staff login. Sign in on this phone, then
          scan the QR again.
        </p>
        <Link
          href="/login"
          className="mt-5 inline-flex min-h-12 items-center justify-center rounded-pill bg-[var(--accent)] px-5 text-[14px] font-semibold text-paper"
        >
          Sign in
        </Link>
      </Shell>
    );
  }

  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "staff.self");
  const view = await resolvePremisesCheckIn(ctx, token);

  if (!view) {
    return (
      <Shell title="This QR is not valid">
        <p className="mt-2 text-[13.5px] text-ink-3">
          It may be from another academy or expired. Ask the owner for a
          fresh printout.
        </p>
      </Shell>
    );
  }

  if (!view.hasStaffRecord) {
    return (
      <Shell title="No staff record">
        <p className="mt-2 text-[13.5px] text-ink-3">
          Your login is not linked to a staff record at {view.tenantName},
          so there is nothing to check in.
        </p>
      </Shell>
    );
  }

  const checkedIn = Boolean(view.today?.checkedInAt);
  const checkedOut = Boolean(view.today?.checkedOutAt);

  return (
    <Shell title={view.tenantName}>
      <p className="mt-2 text-[13.5px] text-ink-3">
        Premises check-in
        {view.today?.checkedInAt
          ? ` · in at ${formatTimeIST(view.today.checkedInAt)}${
              checkedOut && view.today.checkedOutAt
                ? `, out at ${formatTimeIST(view.today.checkedOutAt)}`
                : ""
            }`
          : ""}
      </p>
      {checkedOut ? (
        <p className="mt-4 flex items-center gap-2 text-[14px] font-medium text-ink-2">
          <CheckCircle2 size={18} className="text-ink-3" />
          You are done for today.
        </p>
      ) : (
        <PremisesCheckInButton alreadyCheckedIn={checkedIn} />
      )}
    </Shell>
  );
}
