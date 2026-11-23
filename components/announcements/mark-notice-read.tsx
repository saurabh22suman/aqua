"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";

export function MarkNoticeRead({ title, marking = false }: { title: string; marking?: boolean }) {
  const { pending } = useFormStatus();
  const busy = pending || marking;
  return (
    <Button size="sm" type="submit" disabled={busy} aria-label={busy ? `Marking ${title} as read` : `Mark ${title} as read`}>
      {busy ? "Marking…" : "Mark read"}
    </Button>
  );
}
