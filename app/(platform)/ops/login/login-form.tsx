"use client";

import { useActionState } from "react";
import {
  loginPlatformAction,
  type PlatformLoginResult,
} from "@/lib/actions/platform-auth";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { OpsPanel } from "@/components/ops/ops-primitives";

// H1 — pre-hydration submit goes to the server action endpoint via
// POST (the action's own URL), not to the current URL via GET. The
// password never appears in the query string, regardless of whether
// React has hydrated. useActionState lets the form render the action's
// returned error inline; on success the action calls redirect() and
// the browser navigates.
//
// Ops redesign (28 October 2026): the fields are the SHARED Input and
// the submit is the SHARED Button, so the sign-in screen carries the
// same control metrics as every other console form.
export function PlatformLoginForm() {
  const [state, formAction, isPending] = useActionState(loginPlatformAction, {
    kind: "error",
    message: "",
  } as PlatformLoginResult);
  const error = state?.kind === "error" ? state.message : null;

  return (
    // method="post" is pinned by scripts/e2e-platform-form-leak.ts;
    // suppress the case-only hydration warning React raises for
    // server-action forms (POST vs post).
    <form action={formAction} method="post" suppressHydrationWarning className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-[13px] font-medium text-ink-2">Email</span>
        <Input
          type="email"
          name="email"
          autoComplete="username"
          required
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-[13px] font-medium text-ink-2">
          Password
        </span>
        <Input
          type="password"
          name="password"
          autoComplete="current-password"
          required
        />
      </label>
      {error ? (
        <OpsPanel tone="error" role="alert">
          {error}
        </OpsPanel>
      ) : null}
      <Button type="submit" variant="primary" className="w-full" disabled={isPending}>
        {isPending ? "Signing in…" : "Continue"}
      </Button>
    </form>
  );
}
