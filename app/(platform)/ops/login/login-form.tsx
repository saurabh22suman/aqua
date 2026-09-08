"use client";

import { useActionState } from "react";
import {
  loginPlatformAction,
  type PlatformLoginResult,
} from "@/lib/actions/platform-auth";

// H1 — pre-hydration submit goes to the server action endpoint via
// POST (the action's own URL), not to the current URL via GET. The
// password never appears in the query string, regardless of whether
// React has hydrated. useActionState lets the form render the action's
// returned error inline; on success the action calls redirect() and
// the browser navigates.
export function PlatformLoginForm() {
  const [state, formAction, isPending] = useActionState(loginPlatformAction, {
    kind: "error",
    message: "",
  } as PlatformLoginResult);
  const error = state?.kind === "error" ? state.message : null;

  return (
    <form action={formAction} method="post" className="space-y-4">
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