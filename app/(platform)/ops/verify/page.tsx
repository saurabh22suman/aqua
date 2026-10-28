import { redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { PlatformVerifyForm } from "./verify-form";

export default async function PlatformVerifyPage() {
  const status = await platformAuthStatusAction();
  if (status.kind === "not_found" || status.kind === "expired") {
    redirect("/ops/login");
  }
  if (status.kind === "authenticated") redirect("/ops");
  return (
    <div className="max-w-md">
      <h1 className="font-display text-[24px] font-semibold text-marine">Authenticator code</h1>
      <p className="mt-2 text-[14px] text-ink-2">Enter the code from your authenticator to finish signing in.</p>
      <div className="mt-6"><PlatformVerifyForm /></div>
    </div>
  );
}
