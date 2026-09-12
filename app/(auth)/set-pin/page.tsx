import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { withPlatform } from "@/db/scope";
import { hasCredentialByBaUserId } from "@/lib/services/credentials";
import { homeForSessionAction } from "@/lib/actions/auth-ui";
import { SetPinForm } from "@/components/set-pin-form";

// Set-PIN safety net (2026-09-11 auth feature).
//
// Reached when the redeem flow minted a session without setting a
// credential (the user closed the set-PIN screen, or the credential
// write failed). No session -> /login. Credential already set -> the
// role home: this page only ever SETS a missing PIN; changing one is
// the owner reset link's job.
export default async function SetPinPage() {
  const h = await headers();
  const session = await withPlatform(async () => auth.api.getSession({ headers: h }));
  if (!session?.user) redirect("/login");

  if (await hasCredentialByBaUserId(session.user.id)) {
    const home = await homeForSessionAction();
    redirect(home.kind === "ok" ? home.path : "/login");
  }

  return (
    <main className="px-5 pt-10 max-w-md mx-auto">
      <h1 className="font-display text-[19px] font-semibold">Choose your PIN</h1>
      <p className="mt-2 text-[14px] text-ink-2">
        One last step: pick a 6–12 digit PIN. You will use your mobile number and this PIN
        to sign in from now on.
      </p>
      <SetPinForm />
    </main>
  );
}
