import { redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { PlatformVerifyForm } from "./verify-form";

export default async function PlatformVerifyPage() {
  const status = await platformAuthStatusAction();
  if (status.kind === "not_found" || status.kind === "expired") {
    redirect("/platform/login");
  }
  if (status.kind === "authenticated") redirect("/platform");
  return (
    <div className="max-w-md">
      <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
        Aqua operator
      </p>
      <h1 className="mt-2 font-display text-[24px] font-semibold text-marine">
        Enter your authenticator code
      </h1>
      <p className="mt-1 text-[14px] text-ink-2">
        Open your authenticator app (1Password, Authy, Google
        Authenticator) and enter the 6-digit code for Aqua.
      </p>
      <div className="mt-6">
        <PlatformVerifyForm />
      </div>
    </div>
  );
}
