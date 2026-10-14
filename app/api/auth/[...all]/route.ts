import { auth } from "@/lib/auth/server";
import { withPlatform } from "@/db/scope";

async function handle(request: Request): Promise<Response> {
  // Tenant logins use the PIN boundary; only ops supports OTP sign-in.
  // Internal auth.api.signInEmail remains available to the scoped PIN service.
  const path = new URL(request.url).pathname;
  if (["/sign-in/email", "/sign-in/phone-number", "/phone-number/send-otp", "/phone-number/verify", "/request-password-reset", "/reset-password"]
    .some((endpoint) => path.endsWith(endpoint))) {
    return Response.json({ error: "Use the Aqua sign-in or PIN recovery page." }, { status: 404 });
  }
  // better-auth does not propagate ALS; this wrap is load-bearing, do not remove
  return withPlatform(() => auth.handler(request));
}

export const GET = handle;
export const POST = handle;
