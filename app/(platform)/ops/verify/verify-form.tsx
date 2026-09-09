"use client";

import { useActionState } from "react";
import { useEffect, useRef, useState } from "react";
import {
  verifyPlatformTotpAction,
  type PlatformVerifyResult,
} from "@/lib/actions/platform-auth";

// H1 — pre-hydration submit goes to the server action endpoint via
// POST (no TOTP code in the URL). useActionState surfaces errors
// inline; success calls redirect() and the browser navigates.
//
// The form's auto-submit-on-6-digits behavior (operator types the
// sixth digit, the form submits without an extra click) survives the
// refactor by calling formRef.current.requestSubmit() — the canonical
// way to trigger a <form action> programmatically. The button is
// kept for keyboard users (Enter) and as a no-op fallback.
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
    <form
      ref={formRef}
      action={formAction}
      method="post"
      className="space-y-4"
    >
      <label className="block">
        <span className="block text-[13px] font-medium text-ink-2">
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
              // off, the user falls back to clicking Verify (still
              // works — the button is a normal submit).
              formRef.current?.requestSubmit();
            }
          }}
          required
          className="mt-1 w-full rounded-ctl border border-line bg-paper px-4 py-3 text-[24px] tracking-[0.3em] text-center text-ink placeholder:text-ink-3 focus:border-[var(--accent)] focus:outline-none"
        />
      </label>
      {error ? (
        <p
          role="alert"
          className="rounded-ctl border border-line bg-deck px-3 py-2 text-[13px] text-ink-2"
        >
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={isPending || code.length !== 6}
        className="w-full rounded-pill py-3 text-[15px] font-semibold text-white bg-[var(--accent)] transition-colors duration-150 disabled:opacity-60"
      >
        {isPending ? "Verifying…" : "Verify"}
      </button>
    </form>
  );
}