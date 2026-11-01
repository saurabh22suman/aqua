"use client";

import Link from "next/link";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { Button, buttonClasses } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";

// Owner children error boundary (30 October 2026).
//
// This file sits below app/(owner)/layout.tsx, so it catches a failure in
// the owner child routes while the owner shell, navigation and account
// controls stay available. It deliberately does NOT catch a failure in the
// shell/auth layout itself: that needs a separate boundary and is outside
// this scope.
//
// The surface is generic on purpose. The error message, digest and stack are
// not rendered: a failed owner read can contain a member name, date of birth,
// query value or internal identifier. There is no telemetry here; the
// framework already logs the server failure. The user gets one retry and one
// safe in-app route out.

export default function OwnerErrorBoundary({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <OwnerPage className="max-w-2xl">
      <PageHeader
        eyebrow="Something went wrong"
        title="This page could not be loaded"
        purpose="The page did not finish loading. Try again, or return to the dashboard and start from there."
      />
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button type="button" variant="primary" onClick={() => reset()}>
          Try again
        </Button>
        <Link
          href="/owner"
          className={buttonClasses({ variant: "secondary" })}
        >
          Back to dashboard
        </Link>
      </div>
      <p className="mt-5 text-[12px] leading-relaxed text-ink-3">
        If this keeps happening, tell your administrator which page you were
        on.
      </p>
    </OwnerPage>
  );
}
