"use client";

import { FlaskConical } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

// F-7 (2026-10-13 Indian-user UX audit): the tenant-specific copy was
// pasted onto the Ops control plane, which has no single tenant
// context ("this is a demo tenant" referred to no "this"). The surface
// is derived from the pathname — Ops lives only under /ops (the
// middleware 404s /ops on the apex, and tenant routes never start with
// /ops), so the check is exhaustive. usePathname() is SSR-safe in a
// client component, so the correct variant ships in the first HTML
// with no hydration flash.
//
// This is a separate client component because the server-side gate in
// demo-banner.tsx reads the env flag from lib/env.ts, which loads .env
// from disk (node:fs) and cannot be bundled for the browser. The gate
// passes the copy down; this file only picks a string.
//
// Owner Lavender B (27 October 2026) — the banner is sticky, so it
// sits ON TOP of the shell's own sticky chrome (the header and the
// viewport-bound sidebar) at top:0. It therefore publishes its own
// height as `--app-sticky-offset`, and the shell's sticky elements
// start below it. Without this the sidebar's brand was clipped by the
// banner's height on every scrolled screen, at every width.
export function DemoBannerStrip({
  tenantCopy,
  platformCopy,
}: {
  tenantCopy: string;
  platformCopy: string;
}) {
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);
  const isPlatform = pathname.startsWith("/ops");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const publish = () => {
      document.documentElement.style.setProperty(
        "--app-sticky-offset",
        `${el.offsetHeight}px`,
      );
    };
    publish();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--app-sticky-offset");
    };
  }, []);

  return (
    <div
      ref={ref}
      className="sticky top-0 z-40 bg-marine text-paper"
      data-testid="demo-banner"
    >
      <div className="max-w-screen-md mx-auto px-5 py-1.5 flex items-center justify-center gap-2 text-[11.5px] font-medium">
        <FlaskConical size={12} className="text-paper/70 flex-none" aria-hidden />
        <span>{isPlatform ? platformCopy : tenantCopy}</span>
      </div>
    </div>
  );
}
