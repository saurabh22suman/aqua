import { LogOut } from "lucide-react";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import { getCurrentStaffIdentity } from "@/lib/services/staff";
import { logoutTenantAction } from "@/lib/actions/tenant-auth";
import { requireCoach } from "@/lib/auth/surface-guard";

// K2 — coach's account surface. Minimum the K2 brief asks for: the
// user's name and phone, plus a sign-out button. The bottom nav's
// "Me" tab (app/(coach)/layout.tsx) lands here. A full profile editor
// is explicitly out of scope for the demo; when one lands, it can
// replace the two-line identity block in place without touching the
// nav or the sign-out form.
export default async function CoachMePage() {
  await requireCoach();
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.read");
  const identity = await getCurrentStaffIdentity(ctx);

  return (
    <main className="px-5 pt-6 pb-8">
      <h1 className="font-display text-[19px] font-semibold">Me</h1>

      <section className="mt-5 rounded-card border border-line bg-paper p-4">
        <p className="font-display text-[15px] font-semibold">
          {identity?.fullName ?? "Signed in"}
        </p>
        <p className="mt-1 text-[13px] text-ink-3 font-mono">
          {identity?.phone ?? "No phone on file"}
        </p>
      </section>

      <form action={logoutTenantAction} className="mt-6">
        <button
          type="submit"
          className="flex w-full items-center gap-2 rounded-card border border-line bg-paper px-4 py-3 text-[14px] font-medium text-ink hover:bg-paper/80"
        >
          <LogOut size={16} className="text-ink-3" />
          Sign out
        </button>
      </form>
    </main>
  );
}
