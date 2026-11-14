"use client";

import Image from "next/image";
import { useState } from "react";
import { TenantMark } from "@/components/branding/tenant-mark";
import { deriveInitials, type AccentKey } from "@/lib/branding/accents";

/** A club identity, never a person's avatar. Failed assets retain the same box. */
export function ClubMark({ name, logoUrl, size = 32, accent = "mango", initials }: {
  name: string;
  logoUrl?: string | null;
  size?: number;
  accent?: AccentKey;
  initials?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return <span className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-ctl" style={{ width: size, height: size }}>
    {logoUrl && logoUrl !== failedUrl
      ? <Image src={logoUrl} alt={`${name} logo`} width={size} height={size} unoptimized className="h-full w-full object-contain" onError={() => setFailedUrl(logoUrl)} />
      : <TenantMark initials={initials ?? deriveInitials(name)} accent={accent} size={size} />}
  </span>;
}
