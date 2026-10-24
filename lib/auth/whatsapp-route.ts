import { NextResponse } from "next/server";
import { z } from "zod";
import { whatsappAuthInput, type WhatsAppAuthState } from "@/lib/schemas/whatsapp-auth";
import { issueWhatsAppChallenge, type WhatsAppAuthPurpose } from "@/db/whatsapp-auth";
import { finishOpsWhatsAppLogin, verifyPinResetCode, saveResetPin } from "@/db/whatsapp-auth-complete";
import { PLATFORM_COOKIE_NAME, platformSessionCookieMaxAgeSeconds } from "./platform-cookie";
import { isOpsHost } from "@/lib/ops-host";

export async function handleWhatsAppAuth(request: Request, purpose: WhatsAppAuthPurpose) {
  const input: unknown = await request.json().catch(() => null);
  const parsed = whatsappAuthInput.safeParse(input);
  const intent = z.object({ intent: z.string() }).safeParse(input);
  const fallbackStep = intent.success && intent.data.intent === "save" ? "pin" :
    intent.success && intent.data.intent === "verify" ? "code" : "phone";
  if (!parsed.success) return NextResponse.json({ step: fallbackStep,
    error: parsed.error.issues[0]?.message ?? "Check the form." }, { status: 400 });
  // These routes are pre-authentication. The browser-bound challenge and
  // OTP prove identity; tenant session permissions are not applicable here.
  const host = request.headers.get("host")?.toLowerCase();
  let origin: URL;
  try { origin = new URL(request.headers.get("origin") ?? ""); }
  catch { return NextResponse.json({ error: "Invalid origin." }, { status: 403 }); }
  if (origin.host.toLowerCase() !== host ||
    (process.env.NODE_ENV === "production" && origin.protocol !== "https:") ||
    ((purpose === "ops_login") !== isOpsHost(host))) {
    return NextResponse.json({ error: "Use the sign-in page for this account." }, { status: 403 });
  }
  const cookieName = `aqua_whatsapp_${purpose}`;
  const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const, path: purpose === "ops_login" ? "/ops" : "/api/login", maxAge: 300 };
  const cookieHeader = request.headers.get("cookie") ?? "";
  const token = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  const reply = (state: WhatsAppAuthState) => NextResponse.json(state);
  try {
    if (parsed.data.intent === "request") {
      const challenge = await issueWhatsAppChallenge(parsed.data.phone, purpose);
      const response = reply({ step: "code", notice: "If this number has an active account, check WhatsApp for its code. The code expires in 5 minutes." });
      response.cookies.set(cookieName, challenge, cookieOptions);
      return response;
    }
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return reply({ step: "phone", error: "Your request expired. Request a new code." });
    if (parsed.data.intent === "verify") {
      if (purpose === "ops_login") {
        const result = await finishOpsWhatsAppLogin(token, parsed.data.code);
        if (!result.ok) return reply({ step: "code", error: "Invalid or expired code. Request a new code if needed." });
        const response = NextResponse.json({ step: "done", redirectPath: "/ops" });
        response.cookies.set(PLATFORM_COOKIE_NAME, result.value, { httpOnly: true,
          secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: platformSessionCookieMaxAgeSeconds() });
        response.cookies.set(cookieName, "", { ...cookieOptions, maxAge: 0 });
        return response;
      }
      const result = await verifyPinResetCode(token, parsed.data.code);
      if (!result.ok) return reply({ step: "code", error: "Invalid or expired code. Request a new code if needed." });
      const response = reply({ step: "pin" });
      response.cookies.set(cookieName, token, cookieOptions);
      return response;
    }
    if (purpose !== "pin_reset" || !await saveResetPin(token, parsed.data.pin)) {
      return reply({ step: "phone", error: "Your reset expired. Request a new code." });
    }
    const response = reply({ step: "done", notice: "Your PIN has been saved. Sign in with your new PIN." });
    response.cookies.set(cookieName, "", { ...cookieOptions, maxAge: 0 });
    return response;
  } catch (error) {
    return reply({ step: parsed.data.intent === "request" ? "phone" : fallbackStep,
      error: error instanceof Error ? error.message : "Unable to complete this request. Try again." });
  }
}
