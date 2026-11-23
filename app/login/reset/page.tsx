import { LoginWelcome } from "@/components/auth/login-welcome";
import { WhatsAppAuthForm } from "@/components/whatsapp-auth-form";
import { BackLink } from "@/components/ui/BackLink";

export default function ResetPinPage() {
  return (
    <LoginWelcome>
      <BackLink href="/login" label="Sign in" />
      <h1 className="text-ink">Reset your PIN</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-2">Request a WhatsApp code for your registered mobile number. Enter the code here to choose a new PIN.</p>
      <div className="mt-4 border-t border-line pt-4">
        <WhatsAppAuthForm purpose="pin_reset" />
      </div>
    </LoginWelcome>
  );
}
