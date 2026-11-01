import { redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { PlatformLoginForm } from "./login-form";
import { OpsCard, OpsPageHeader, OpsPanel } from "@/components/ops/ops-primitives";

// Ops redesign (28 October 2026): the sign-in screen is a focused card
// on the console canvas — no navigation, no rail, nothing to click
// that would go nowhere.
export default async function PlatformLoginPage() {
  const status = await platformAuthStatusAction();
  if (status.kind === "authenticated") redirect("/ops");
  if (status.kind === "unauthenticated") redirect("/ops/verify");
  return (
    <div className="w-full max-w-[440px]">
      <OpsPageHeader
        eyebrow="Aqua operator"
        title="Sign in"
        lede="Use your operator password, then confirm with your authenticator code."
      />
      <OpsCard className="mt-6 p-6">
        <PlatformLoginForm />
      </OpsCard>
      <OpsPanel tone="warn" className="mt-5" title="Forgotten password or lost authenticator?">
        Operator enrolment is a separate request — it is not a self-service
        flow on this screen. Ask the platform owner to re-issue your
        credential.
      </OpsPanel>
    </div>
  );
}
