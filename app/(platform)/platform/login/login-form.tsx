"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  loginPlatformAction,
  type PlatformLoginResult,
} from "@/lib/actions/platform-auth";

export function PlatformLoginForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    const result: PlatformLoginResult = await loginPlatformAction({
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
    });
    if (result.kind === "needs_totp") {
      router.push("/platform/verify");
      return;
    }
    if (result.kind === "error") setError(result.message);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="username"
        required
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
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
        disabled={isPending}
        onClick={() => startTransition(() => undefined)}
        className="w-full rounded-pill py-3 text-[15px] font-semibold text-white bg-[var(--accent)] transition-colors duration-150 disabled:opacity-60"
      >
        {isPending ? "Signing in…" : "Continue"}
      </button>
    </form>
  );
}

function Field({
  label,
  name,
  type,
  autoComplete,
  required,
}: {
  label: string;
  name: string;
  type: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[13px] font-medium text-ink-2">{label}</span>
      <input
        type={type}
        name={name}
        autoComplete={autoComplete}
        required={required}
        className="mt-1 w-full rounded-ctl border border-line bg-paper px-4 py-3 text-[16px] text-ink placeholder:text-ink-3 focus:border-[var(--accent)] focus:outline-none"
      />
    </label>
  );
}
