"use client";

import { useActionState } from "react";
import { useEffect, useRef, useState } from "react";
import {
  verifyPlatformTotpAction,
  type PlatformVerifyResult,
} from "@/lib/actions/platform-auth";
import { Button } from "@/components/ui/Button";
import { OpsPanel } from "@/components/ops/ops-primitives";

// H1 — pre-hydration submit goes to the server action endpoint via
// POST (no TOTP code in the URL). useActionState surfaces errors
// inline; success calls redirect() and the browser navigates.
//
// The form's auto-submit-on-6-digits behavior (operator types the
// sixth digit, the form submits without an extra click) survives the
// refactor by calling formRef.current.requestSubmit() — the canonical
// way to trigger a <form action> programmatically. The button is
// kept for keyboard users (Enter) and as a no-op fallback.
//
// Ops redesign (28 October 2026): the code field keeps its own
// presentation — a wide-tracked, centred numeric field — but wears the
// shared control metrics (the neutral entry surface, the 10px radius,
// 16px+ control text) so it is the same control family as the sign-in
// screen.
export function PlatformVerifyForm() {
  const [state, formAction, isPending] = useActionState(verifyPlatformTotpAction, {
    kind: "error",
    message: "",
  } as PlatformVerifyResult);
  const error = state?.kind === "error" ? state.message : null;
  const [code, setCode] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Auto-focus the code field on mount — operator's eyes are already
  // on the authenticator app, and any extra click is friction.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Re-focus and clear after an error so the operator can retype.
  useEffect(() => {
    if (error) {
      setCode("");
      inputRef.current?.focus();
    }
  }, [error]);

  return (
    // method="post" is pinned by scripts/e2e-platform-form-leak.ts;
    // suppress the case-only hydration warning React raises for
    // server-action forms (POST vs post).
    <form
      ref={formRef}
      action={formAction} method="post" suppressHydrationWarning
      className="space-y-4"
    >
      <label className="block">
        <span className="mb-1 block text-[13px] font-medium text-ink-2">
          6-digit code
        </span>
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          name="code"
          value={code}
          onChange={(e) => {
            const next = e.target.value.replace(/\D/g, "").slice(0, 6);
            setCode(next);
            if (next.length === 6) {
              // requestSubmit fires the form's action handler. With JS
              // still hydrating, native validation and the Verify button
              // submit the same POST without depending on React state.
              formRef.current?.requestSubmit();
            }
          }}
          required
          className="min-h-14 w-full rounded-ctl border border-[var(--control-border)] bg-[var(--control-surface)] px-4 py-3 text-center font-mono text-[24px] tracking-[0.3em] text-ink placeholder:text-ink-3 focus:border-[var(--accent-strong)] focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
        />
      </label>
      {error ? (
        <OpsPanel tone="error" role="alert">
          {error}
        </OpsPanel>
      ) : null}
      {/* Native required/pattern validation also works before hydration. */}
      <Button type="submit" variant="primary" className="w-full" disabled={isPending}>
        {isPending ? "Verifying…" : "Verify"}
      </Button>
    </form>
  );
}
