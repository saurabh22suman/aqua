"use client";

import { FlaskConical } from "lucide-react";
import { usePathname } from "next/navigation";

// F-7 (2026-09-13 Indian-user UX audit): the tenant-specific copy was
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
export function DemoBannerStrip({
  tenantCopy,
  platformCopy,
}: {
  tenantCopy: string;
  platformCopy: string;
}) {
  const pathname = usePathname();
  const isPlatform = pathname.startsWith("/ops");
  return (
    <div
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
