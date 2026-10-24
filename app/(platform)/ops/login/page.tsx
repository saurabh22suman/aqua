import { redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { WhatsAppAuthForm } from "@/components/whatsapp-auth-form";
import { PlatformLoginForm } from "./login-form";
import { env } from "@/lib/env";

// Signed-in operators go directly to their control plane.
//
// Two operator doors exist, and which ones are on is a DEPLOYMENT
// decision, not a code decision:
//
//   * the env operator door (OPS_EMAIL + OPS_PASSWORD) — the
//     credentials live in the deployment's environment, the password
//     is checked in constant time, and the session is created fully
//     authenticated (no TOTP). See db/platform-auth-env.ts.
//   * the WhatsApp door — a one-time code delivered to a registered
//     operator's phone.
//
// The env door was built for exactly this ("env-only ops login",
// slices 1/12 + 11/12) and the backend still honours it
// (db/platform-auth.ts routes to it whenever the pair is set), but
// this page stopped offering it when the WhatsApp form arrived: the
// email + password form was left in the tree but never rendered, so
// a deployment that set OPS_EMAIL + OPS_PASSWORD had a working door
// in the code and NO way through the door in the browser.
//
// So the env form is rendered whenever the door is configured. The
// WhatsApp door stays as well — it is the per-operator door, and it
// keeps working for operators who have a registered phone.
export default async function PlatformLoginPage() {
  const status = await platformAuthStatusAction();
  if (status.kind === "authenticated") redirect("/ops");
  const envDoorOpen = env.OPS_EMAIL !== undefined && env.OPS_PASSWORD !== undefined;
  return (
    <div className="max-w-md">
      <p className="text-[13px] text-ink-2">
        Aqua operator
      </p>
      <h1 className="mt-2 font-display text-[24px] font-semibold text-marine">
        Sign in
      </h1>
      {envDoorOpen ? (
        <>
          <p className="mt-1 text-[14px] text-ink-2">
            Sign in with the operator credentials configured for this deployment.
          </p>
          <div className="mt-6">
            <PlatformLoginForm />
          </div>
          <p className="mt-8 text-[14px] text-ink-2">
            Or use your registered mobile number. Your sign-in code arrives on
            WhatsApp.
          </p>
          <div className="mt-4">
            <WhatsAppAuthForm purpose="ops_login" />
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 text-[14px] text-ink-2">
            Use your registered mobile number. Your sign-in code arrives on
            WhatsApp.
          </p>
          <div className="mt-6">
            <WhatsAppAuthForm purpose="ops_login" />
          </div>
        </>
      )}
    </div>
  );
}
