import { requireOwner } from "@/lib/auth/surface-guard";
import { requirePermission } from "@/lib/auth/permission";
import { signPremisesQrToken } from "@/lib/services/premises-qr";
import { BackLink } from "@/components/ui/BackLink";
import { PremisesQrCard } from "@/components/premises-qr-card";

// V-25 — the premises check-in QR. Staff scan it with their phone
// camera; the URL opens /check-in/<token> and one tap records a
// self_qr check-in (lib/services/staff-attendance.ts). No scanner
// dependency: the camera app is the scanner.
//
// The token is minted per render — a fresh printout is always valid;
// the previous printout keeps working until its 180-day TTL lapses.

export default async function StaffCheckInQrPage() {
  const ctx = await requireOwner();
  requirePermission(ctx, "staff.roster");

  const { token } = signPremisesQrToken({ tenantId: ctx.tenantId });

  return (
    <main className="px-5 pt-6 pb-8">
      <BackLink href="/owner/staff/roster" label="Roster" />
      <h1 className="mt-2 font-display text-[19px] font-semibold">
        Check-in QR
      </h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        Print this and put it where staff arrive. Scanning opens the
        check-in page on their phone — they sign in once and tap check
        in.
      </p>

      <PremisesQrCard urlPath={`/check-in/${token}`} />

      <p className="mt-4 text-[12.5px] text-ink-3">
        The poster is valid for 180 days. Printing this page again mints
        a new one; an old poster stops working when its validity ends.
      </p>
    </main>
  );
}
