"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useUnsavedHistoryGuard } from "@/components/use-unsaved-history-guard";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";

export function FacilityDraftGuard({ dirty, busy, scope = "this facility" }: { dirty: boolean; busy: boolean; scope?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [destination, setDestination] = useState<string | null>(null);
  const [back, setBack] = useState(false);
  const history = useUnsavedHistoryGuard(dirty, busy, () => { setBack(true); setDestination(null); setOpen(true); });

  useEffect(() => {
    if (!dirty) return;
    function onLink(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest("a[href]");
      if (!(link instanceof HTMLAnchorElement) || link.target || link.hasAttribute("download")) return;
      const next = new URL(link.href, window.location.href);
      if (next.origin !== window.location.origin || next.href === window.location.href) return;
      event.preventDefault();
      event.stopPropagation();
      if (!busy) { setBack(false); setDestination(`${next.pathname}${next.search}${next.hash}`); setOpen(true); }
    }
    function onUnload(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ""; }
    document.addEventListener("click", onLink, true);
    window.addEventListener("beforeunload", onUnload);
    return () => { document.removeEventListener("click", onLink, true); window.removeEventListener("beforeunload", onUnload); };
  }, [dirty, busy]);

  return <Dialog open={open} onOpenChange={setOpen} title="Discard unsaved billing changes?"
    description={`Your changes belong to ${scope} and will not be applied to another scope.`}
    footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Stay</Button><Button disabled={busy} onClick={() => {
      setOpen(false);
      if (back) history.discardBack();
      else if (destination) history.leave(() => router.push(destination));
    }}>Discard and leave</Button></>} />;
}
