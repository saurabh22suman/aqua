"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export function EnquiriesRetry({ label = "Retry enquiries" }: { label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button size="sm" disabled={pending} onClick={() => startTransition(() => router.refresh())}>
      {pending ? "Loading enquiries…" : label}
    </Button>
  );
}
