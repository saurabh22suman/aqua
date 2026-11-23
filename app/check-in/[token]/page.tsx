import { redirect } from "next/navigation";
import { ClubSelectionRequired } from "@/lib/auth/active-club";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { requireDefaultCtx, sessionExists } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import { resolvePremisesCheckIn } from "@/lib/services/premises-check-in";
import { PremisesCheckInButton } from "@/components/premises-check-in-button";
import { PageHeader } from "@/components/ui/PageHeader";
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
    <main className="mx-auto min-h-dvh max-w-xl px-4 py-8 sm:py-12">
      <section className="rounded-card border border-line bg-paper p-4 [overflow-wrap:anywhere] sm:p-6">
        <PageHeader title={title} />
        <div className="mt-3 border-t border-line pt-3">{children}</div>
      </section>
    </main>
  );
}

async function checkInContext() {
  try {
    return await sessionExists() ? await requireDefaultCtx() : null;
  } catch (error) {
    if (error instanceof ClubSelectionRequired) redirect("/clubs");
    throw error;
  }
}

export default async function PremisesCheckInPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const ctx = await checkInContext();
  if (!ctx) {
    return (
      <Shell title="Sign in first">
        <p className="text-sm leading-relaxed text-ink-2">
          Check-in needs your staff login. Sign in on this phone, then
          scan the QR again.
        </p>
        <Link
          href="/login"
          className="mt-5 inline-flex min-h-12 items-center justify-center rounded-pill bg-[var(--accent-strong)] px-5 text-[14px] font-semibold text-paper"
        >
          Sign in
        </Link>
      </Shell>
    );
  }

  requirePermission(ctx, "staff.self");
  const view = await resolvePremisesCheckIn(ctx, token);

  if (!view) {
    return (
      <Shell title="This QR is not valid">
        <p className="text-sm leading-relaxed text-ink-2">
          Check that you scanned your club’s current staff QR. Ask your club for the current code if you need it.
        </p>
      </Shell>
    );
  }

  if (!view.hasStaffRecord) {
    return (
      <Shell title="No staff record">
        <p className="text-sm leading-relaxed text-ink-2">
          Ask {view.tenantName} to link your login to your staff record, then scan the QR again.
        </p>
      </Shell>
    );
  }

  const checkedIn = Boolean(view.today?.checkedInAt);
  const checkedOut = Boolean(view.today?.checkedOutAt);

  return (
    <Shell title={view.tenantName}>
      <h2 className="text-base font-semibold text-ink">Premises check-in</h2>
      <p className="mt-1 text-sm text-ink-2">
        {view.today?.checkedInAt ? <>Checked in at {formatTimeIST(view.today.checkedInAt)}{view.today.checkedOutAt ? ` · Checked out at ${formatTimeIST(view.today.checkedOutAt)}` : ""}</> : "Confirm when you arrive for your shift."}
      </p>
      {checkedOut ? (
        <p role="status" className="mt-4 flex items-center gap-2 rounded-ctl border border-line bg-deck p-3 text-[14px] font-medium text-ink">
          <CheckCircle2 size={18} aria-hidden="true" className="shrink-0 text-ink-3" />
          You are done for today.
        </p>
      ) : (
        <PremisesCheckInButton alreadyCheckedIn={checkedIn} />
      )}
    </Shell>
  );
}
