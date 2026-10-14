import { WhatsAppAuthForm } from "@/components/whatsapp-auth-form";
import { BackLink } from "@/components/ui/BackLink";

export default function ResetPinPage() {
  return <main className="mx-auto max-w-md px-5 pt-12 pb-8">
    <BackLink href="/login" label="Sign in" />
    <h1 className="mt-6 font-display text-[24px] font-semibold text-marine">Reset your PIN</h1>
    <p className="mt-2 mb-6 text-[14px] text-ink-2">Verify your registered WhatsApp number, then choose a new PIN for this login.</p>
    <WhatsAppAuthForm purpose="pin_reset" />
  </main>;
}
