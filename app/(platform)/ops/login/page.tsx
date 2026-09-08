import { redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { PlatformLoginForm } from "./login-form";

// Operators who are already fully signed in skip the login screen —
// not strictly required for security (the verify step gates access)
// but it removes a confusing two-step on the same screen.
export default async function PlatformLoginPage() {
  const status = await platformAuthStatusAction();
  if (status.kind === "authenticated") redirect("/platform");
  return (
    <div className="max-w-md">
      <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
        Aqua operator
      </p>
      <h1 className="mt-2 font-display text-[24px] font-semibold text-marine">
        Sign in
      </h1>
      <p className="mt-1 text-[14px] text-ink-2">
        Aqua operators run the platform control plane. Tenant users sign in
        from their academy URL.
      </p>
      <div className="mt-6">
        <PlatformLoginForm />
      </div>
    </div>
  );
}
