import { redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { PlatformLoginForm } from "./login-form";

export default async function PlatformLoginPage() {
  const status = await platformAuthStatusAction();
  if (status.kind === "authenticated") redirect("/ops");
  if (status.kind === "unauthenticated") redirect("/ops/verify");
  return (
    <div className="max-w-md">
      <p className="text-[13px] text-ink-2">Aqua operator</p>
      <h1 className="mt-2 font-display text-[24px] font-semibold text-marine">Sign in</h1>
      <p className="mt-1 text-[14px] text-ink-2">Use your operator password, then confirm with your authenticator code.</p>
      <div className="mt-6"><PlatformLoginForm /></div>
    </div>
  );
}
