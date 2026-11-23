import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { logoutPlatformAction, platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { Button } from "@/components/ui/Button";
import { PlatformVerifyForm } from "./verify-form";
import { OpsCard, OpsPageHeader, OpsPanel } from "@/components/ops/ops-primitives";

export const metadata: Metadata = { title: "Operator authentication" };

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
        eyebrow="Operator sign-in · Step 2 of 2"
        title="Authenticator code"
        lede="Enter the code from your authenticator to finish signing in."
      />
      <OpsCard className="mt-6 p-6">
        <PlatformVerifyForm />
        <form action={restartSignIn} className="mt-3">
          <Button type="submit" variant="ghost" className="w-full">Start sign-in again</Button>
        </form>
      </OpsCard>
      <OpsPanel tone="info" className="mt-5" title="If the code is rejected">
        Wait for a fresh code in your authenticator. If the sign-in attempt has
        expired, start sign-in again and re-enter your password.
      </OpsPanel>
    </div>
  );
}

async function restartSignIn() {
  "use server";
  await logoutPlatformAction();
  redirect("/ops/login");
}
