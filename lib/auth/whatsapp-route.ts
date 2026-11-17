import { NextResponse } from "next/server";
import { z } from "zod";
import { whatsappAuthInput, type WhatsAppAuthState } from "@/lib/schemas/whatsapp-auth";
import { issueWhatsAppChallenge, type WhatsAppAuthPurpose } from "@/db/whatsapp-auth";
import { verifyPinResetCode, saveResetPin } from "@/db/whatsapp-auth-complete";
import { isOpsHost } from "@/lib/ops-host";

// The only answers this pre-auth route may give. Every other failure is
// internal and must not reach an unauthenticated caller.
const SAFE_ERRORS = new Set([
  "Enter a valid mobile number.",
  "WhatsApp is unavailable. Please try again later.",
  "Please wait before requesting another code.",
]);

// An internal failure is reported as UNCERTAIN: 503 with one fixed sentence,
// so the caller can tell "we do not know what happened" from "we refused
// you" and never has to guess. The sentence must not invite a repeat of the
// same request: at the save phase a blind repeat is a blind reset retry.
function uncertain(error: unknown, step: WhatsAppAuthState["step"]) {
  const message = error instanceof Error ? error.message : "";
  if (SAFE_ERRORS.has(message)) {
    return NextResponse.json({ step, error: message });
  }
  return NextResponse.json(
    { step, error: "We could not confirm the outcome of this request." },
    { status: 503 },
  );
}

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
  if (purpose === "ops_login") {
    return NextResponse.json({ error: "Sign in with your operator password and authenticator code." }, { status: 403 });
  }
  const cookieName = `aqua_whatsapp_${purpose}`;
  const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const, path: "/api/login", maxAge: 300 };
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
      const result = await verifyPinResetCode(token, parsed.data.code);
      if (!result.ok) return reply({ step: "code", error: "Invalid or expired code. Request a new code if needed." });
      const response = reply({ step: "pin" });
      response.cookies.set(cookieName, token, cookieOptions);
      return response;
    }
    if (!await saveResetPin(token, parsed.data.pin)) {
      return reply({ step: "phone", error: "Your reset expired. Request a new code." });
    }
    const response = reply({ step: "done", notice: "Your PIN has been saved. Sign in with your new PIN." });
    response.cookies.set(cookieName, "", { ...cookieOptions, maxAge: 0 });
    return response;
  } catch (error) {
    return uncertain(error, parsed.data.intent === "request" ? "phone" : fallbackStep);
  }
}
