"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import Link from "next/link";
import type { WhatsAppAuthState } from "@/lib/schemas/whatsapp-auth";
import { Button } from "@/components/ui/Button";

const fieldClass = "mt-1 w-full min-h-[48px] rounded-ctl border border-line bg-paper px-4 py-3 text-[16px] text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]";

export function WhatsAppAuthForm({ purpose }: { purpose: "ops_login" | "pin_reset" }) {
  const router = useRouter();
  const [state, setState] = useState<WhatsAppAuthState>({ step: "phone" });
  const [pending, setPending] = useState(false);
  const [requestAgain, setRequestAgain] = useState(false);
  const [phone, setPhone] = useState("");
  const [ready, setReady] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const submitting = useRef(false);
  const previousStep = useRef("phone");
  const id = useId();
  const step = requestAgain ? "phone" : state.step;
  useEffect(() => { setReady(true); }, []);
  useEffect(() => {
    if (!pending && step !== previousStep.current) {
      formRef.current?.querySelector<HTMLInputElement>("input:not([type=hidden])")?.focus();
      previousStep.current = step;
    }
  }, [step, pending]);
  async function submit(form: HTMLFormElement) {
    if (!ready || submitting.current) return;
    const body = JSON.stringify(Object.fromEntries(new FormData(form)));
    submitting.current = true;
    setPending(true);
    try {
      const response = await fetch(purpose === "ops_login" ? "/ops/api/whatsapp-auth" : "/api/login/pin-recovery", {
        method: "POST", headers: { "Content-Type": "application/json" }, body,
        signal: AbortSignal.timeout(15_000),
      });
      const result = z.object({ step: z.enum(["phone", "code", "pin", "done"]), error: z.string().optional(),
        notice: z.string().optional(), redirectPath: z.literal("/ops").optional() }).parse(await response.json());
      setState(result); setRequestAgain(false);
      if (result.redirectPath) { router.push(result.redirectPath); router.refresh(); }
    } catch {
      setState({ step, error: "Could not complete this request. Please try again." });
      setRequestAgain(false);
    }
    finally { submitting.current = false; setPending(false); }
  }
  if (step === "done") return <div className="space-y-4">
    <p role="status" className="text-[14px] text-ink-2">{state.notice}</p>
    <Link href="/login" className="inline-flex min-h-[44px] items-center text-[14px] font-medium underline">Back to sign in</Link>
  </div>;
  return <form ref={formRef} aria-busy={pending} method="post" action={purpose === "ops_login" ? "/ops/api/whatsapp-auth" : "/api/login/pin-recovery"}
    className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(event.currentTarget); }}>
    <noscript><p className="text-[14px] text-ink-2">Enable JavaScript and reload this page to request and verify your WhatsApp code.</p></noscript>
    <fieldset disabled={!ready || pending} className="min-w-0 space-y-4">
    <input type="hidden" name="intent" value={step === "phone" ? "request" : step === "code" ? "verify" : "save"} />
    {step === "phone" ? <div>
      <label htmlFor={`${id}-phone`} className="block text-[13px] font-medium text-ink-2">Registered mobile number</label>
      <input id={`${id}-phone`} name="phone" type="tel" autoComplete="tel" required maxLength={40}
        value={phone} onChange={(event) => setPhone(event.target.value)} className={fieldClass}
        aria-describedby={`${id}-phone-help${state.error && !requestAgain ? ` ${id}-error` : ""}`} />
      <span id={`${id}-phone-help`} className="mt-1 block text-[12px] text-ink-2">Use the number registered with Aqua. Indian numbers can be entered without +91.</span>
    </div> : step === "code" ? <label className="block">
      <span className="text-[13px] font-medium text-ink-2">6-digit WhatsApp code</span>
      <input key="otp" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6}
        required className={fieldClass} aria-invalid={Boolean(state.error)}
        aria-describedby={`${id}-code-help${state.error ? ` ${id}-error` : ""}`} />
    </label> : <>
      <label className="block"><span className="text-[13px] font-medium text-ink-2">New PIN</span>
        <input name="pin" type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{6,12}"
          minLength={6} maxLength={12} required className={fieldClass} /></label>
      <label className="block"><span className="text-[13px] font-medium text-ink-2">Re-enter new PIN</span>
        <input name="confirmPin" type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{6,12}"
          minLength={6} maxLength={12} required className={fieldClass} /></label>
      <p className="text-[12px] text-ink-2">Use 6–12 digits. Saving signs out existing sessions for this login.</p>
    </>}
    {state.notice && !requestAgain ? <p role="status" className="text-[13px] text-ink-2">{state.notice}</p> : null}
    {step === "code" ? <p id={`${id}-code-help`} className="text-[12px] text-ink-2">No code? Check the registered number, then request another after one minute.</p> : null}
    {state.error && !requestAgain ? <p id={`${id}-error`} role="alert" className="text-[13px] text-ink-2">{state.error}</p> : null}
    <Button type="submit" variant="primary" size="lg" pill disabled={!ready || pending} className="w-full focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]">
      {pending ? "Please wait…" : step === "phone" ? "Send WhatsApp code" : step === "code" ? "Verify code" : "Save PIN"}
    </Button>
    {step === "phone" && pending ? <p role="status" className="text-[13px] text-ink-2">Requesting your code. This may take a few seconds.</p> : null}
    {step !== "phone" ? <button type="button" disabled={!ready || pending} onClick={() => setRequestAgain(true)}
      className="min-h-[44px] text-[14px] text-ink-2 underline">Request a new code or change number</button> : null}
    </fieldset>
  </form>;
}
