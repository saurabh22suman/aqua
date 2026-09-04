"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  verifyPlatformTotpAction,
  type PlatformVerifyResult,
} from "@/lib/actions/platform-auth";

export function PlatformVerifyForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus the code field on mount — operator's eyes are already
  // on the authenticator app, and any extra click is friction.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function submit(next: string) {
    if (!/^\d{6}$/.test(next)) return;
    setError(null);
    startTransition(async () => {
      const result: PlatformVerifyResult = await verifyPlatformTotpAction({
        code: next,
      });
      if (result.kind === "ok") {
        router.push("/platform");
        router.refresh();
        return;
      }
      setError(result.message);
      setCode("");
      inputRef.current?.focus();
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit(code);
      }}
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
          value={code}
          onChange={(e) => {
            const next = e.target.value.replace(/\D/g, "").slice(0, 6);
            setCode(next);
            if (next.length === 6) void submit(next);
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
        onClick={() => startTransition(() => undefined)}
        className="w-full rounded-pill py-3 text-[15px] font-semibold text-white bg-[var(--accent)] transition-colors duration-150 disabled:opacity-60"
      >
        {isPending ? "Verifying…" : "Verify"}
      </button>
    </form>
  );
}
