"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  verifyPlatformTotpAction,
  type PlatformVerifyResult,
} from "@/lib/actions/platform-auth";
import { Button } from "@/components/ui/Button";
import { OpsPanel } from "@/components/ops/ops-primitives";

export function PlatformVerifyForm() {
  const [state, formAction, isPending] = useActionState(verifyPlatformTotpAction, {
    kind: "error",
    message: "",
  } as PlatformVerifyResult);
  const error = state?.kind === "error" ? state.message : null;
  const [code, setCode] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus the code field on mount — operator's eyes are already
  // on the authenticator app, and any extra click is friction.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (state?.kind === "error" && state.message) {
      setCode("");
      inputRef.current?.focus();
    }
  }, [state]);

  return (
    // method="post" is pinned by scripts/e2e-platform-form-leak.ts;
    // suppress the case-only hydration warning React raises for
    // server-action forms (POST vs post).
    <form
      action={formAction} method="post" suppressHydrationWarning
      className="space-y-4" aria-busy={isPending}
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
          onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
          readOnly={isPending}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "operator-code-error" : undefined}
          required
          className="min-h-14 w-full rounded-ctl border border-[var(--control-border)] bg-[var(--control-surface)] px-4 py-3 text-center font-mono text-[24px] tracking-[0.3em] text-ink placeholder:text-ink-3 focus:border-[var(--accent-strong)] focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
        />
      </label>
      {error ? (
        <div id="operator-code-error">
          <OpsPanel tone="error" role="alert">
            {error}
          </OpsPanel>
        </div>
      ) : null}
      {/* Native required/pattern validation also works before hydration. */}
      <Button type="submit" variant="primary" className="w-full" disabled={isPending}>
        {isPending ? "Verifying…" : "Verify"}
      </Button>
    </form>
  );
}
