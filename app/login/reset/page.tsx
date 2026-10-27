import { AuthShell } from "@/components/auth/auth-shell";
import { ClubEditorialPanel } from "@/components/auth/club-editorial-panel";
import { BrandLockup } from "@/components/auth/sports-mark";
import { WhatsAppAuthForm } from "@/components/whatsapp-auth-form";
import { BackLink } from "@/components/ui/BackLink";

// The PIN recovery screen — the other half of the sign-in journey.
//
// It now sits in the same AuthShell as `/login`, so the frame, the
// brand and the editorial panel are the same on both screens and the
// journey reads as one surface.
//
// The form is unchanged and is deliberately not restyled here:
// `components/whatsapp-auth-form.tsx` is shared with the operator
// console, so its internals belong to that surface's owner. What this
// page owns is the frame around it.
export default function ResetPinPage() {
  return (
    <AuthShell panel={<ClubEditorialPanel />}>
      <div>
        <div className="mb-6 lg:hidden">
          <BrandLockup size="sm" />
        </div>
        <BackLink href="/login" label="Sign in" />
        <h1 className="mt-4 font-display text-[26px] font-semibold leading-tight text-ink">
          Reset your PIN
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
          Verify your registered WhatsApp number, then choose a new PIN for
          this login.
        </p>
        <div className="mt-7">
          <WhatsAppAuthForm purpose="pin_reset" />
        </div>
      </div>
    </AuthShell>
  );
}
