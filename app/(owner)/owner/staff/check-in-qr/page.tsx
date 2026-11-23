import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { hasPermission } from "@/lib/auth/permission";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { clubDisplayName } from "@/db/club-selection";
import { getBranding } from "@/lib/services/branding";
import { signPremisesQrToken } from "@/lib/services/premises-qr";
import { BackLink } from "@/components/ui/BackLink";
import { PremisesQrCard } from "@/components/premises-qr-card";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";

// V-25 — the premises check-in QR. Staff scan it with their phone
// camera; the URL opens /check-in/<token> and one tap records a
// self_qr check-in (lib/services/staff-attendance.ts). No scanner
// dependency: the camera app is the scanner.
//
// The token is minted per render — a fresh printout is always valid;
// the previous printout keeps working until its 180-day TTL lapses.

export default async function StaffCheckInQrPage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "staff.roster");

  const { token } = signPremisesQrToken({ tenantId: ctx.tenantId });
  const branding = await getBranding(ctx).catch(() => null);
  const canInvite = hasPermission(ctx, "staff.invite");
  const canSeeAttendance = hasPermission(ctx, "staff.attendance");

  return (
    <OwnerPage workflow="setup">
      <BackLink href="/owner/staff/roster" label="Roster" />
      <PageHeader
        title={<>Check-in QR</>}
        purpose={<>Print this and put it where staff arrive. Scanning opens the
        check-in page on their phone — they sign in once and tap check
        in.</>}
      />

      <PremisesQrCard urlPath={`/check-in/${token}`} academyName={branding ? clubDisplayName(branding.fallbackDisplayName, branding) : undefined} />

      <section
        aria-labelledby="before-you-print"
        className="mt-5 rounded-card border border-line bg-paper p-5"
      >
        <h2
          id="before-you-print"
          className="font-display text-[16px] font-semibold text-ink"
        >
          Before you print
        </h2>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[13px] text-ink-2">
          <li>Put the poster where staff arrive and can see it.</li>
          <li>
            Staff scan it, sign in with their phone and PIN, then confirm their
            own check-in.
          </li>
          <li>
            The mark appears in staff attendance for that day. Someone without a
            login cannot check in.
          </li>
        </ol>
        <p className="mt-3 text-[12.5px] text-ink-3">
          The code is issued for this academy only and contains no staff
          details.
        </p>
        {canInvite || canSeeAttendance ? (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[13px] font-medium">
            {canInvite ? (
              <Link
                href="/owner/staff/invitations/new"
                className="inline-flex min-h-11 items-center text-[var(--accent-ink)] underline underline-offset-2 hover:text-ink"
              >
                Invite staff to sign in
              </Link>
            ) : null}
            {canSeeAttendance ? (
              <Link
                href="/owner/staff/attendance"
                className="inline-flex min-h-11 items-center text-[var(--accent-ink)] underline underline-offset-2 hover:text-ink"
              >
                Open staff attendance
              </Link>
            ) : null}
          </div>
        ) : null}
      </section>

      <p className="mt-4 text-[12.5px] text-ink-3">
        Reload this page for a fresh poster before the current one expires.
      </p>
    </OwnerPage>
  );
}
