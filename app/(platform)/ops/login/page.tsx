import { redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { WhatsAppAuthForm } from "@/components/whatsapp-auth-form";

// Signed-in operators go directly to their control plane.
export default async function PlatformLoginPage() {
  const status = await platformAuthStatusAction();
  if (status.kind === "authenticated") redirect("/ops");
  return (
    <div className="max-w-md">
      <p className="text-[13px] text-ink-2">
        Aqua operator
      </p>
      <h1 className="mt-2 font-display text-[24px] font-semibold text-marine">
        Sign in
      </h1>
      <p className="mt-1 text-[14px] text-ink-2">
        Use your registered mobile number. Your sign-in code arrives on WhatsApp.
      </p>
      <div className="mt-6">
        <WhatsAppAuthForm purpose="ops_login" />
      </div>
    </div>
  );
}
