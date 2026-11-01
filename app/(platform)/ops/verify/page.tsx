import { redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { PlatformVerifyForm } from "./verify-form";
import { OpsCard, OpsPageHeader, OpsPanel } from "@/components/ops/ops-primitives";

// Ops redesign (28 October 2026): the authenticator screen is a focused
// card on the console canvas, with the one thing that can go wrong
// explained beside it.
export default async function PlatformVerifyPage() {
  const status = await platformAuthStatusAction();
  if (status.kind === "not_found" || status.kind === "expired") {
    redirect("/ops/login");
  }
  if (status.kind === "authenticated") redirect("/ops");
  return (
    <div className="w-full max-w-[440px]">
      <OpsPageHeader
        eyebrow="Aqua operator"
        title="Authenticator code"
        lede="Enter the code from your authenticator to finish signing in."
      />
      <OpsCard className="mt-6 p-6">
        <PlatformVerifyForm />
      </OpsCard>
      <OpsPanel tone="info" className="mt-5" title="If the code is rejected">
        Codes are single-use and time-limited, and a code cannot complete a
        different pending challenge. Wait for the authenticator to show a
        fresh code, or start sign-in again.
      </OpsPanel>
    </div>
  );
}
