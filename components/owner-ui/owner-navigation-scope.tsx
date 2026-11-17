"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { isFacilityScopedPath, resolveRequestedFacility } from "@/lib/facility";

type Props = { pathname: string; children: (params: Pick<URLSearchParams, "get">) => ReactNode };
const empty = new URLSearchParams();
const ScopeMemory = createContext<{ value: string | null; remember: (value: string | null) => void } | null>(null);

/** In-memory scope survives unscoped Owner pages, but never grants data access. */
export function OwnerNavigationScopeProvider({ children }: { children: ReactNode }) {
  const [value, remember] = useState<string | null>(null);
  const memory = useMemo(() => ({ value, remember }), [value]);
  return <ScopeMemory.Provider value={memory}>{children}</ScopeMemory.Provider>;
}

function ScopedQuery({ pathname, children }: Props) {
  const params = useSearchParams();
  const memory = useContext(ScopeMemory);
  const facility = params.get("facility");
  const location = pathname === "/owner/schedule" ? params.get("location") : null;
  const remember = memory?.remember;
  useEffect(() => {
    if (!remember) return;
    if (facility === null && location === null) { remember(null); return; }
    const resolved = resolveRequestedFacility({ facility, location });
    remember(resolved.valid ? resolved.facilityId ?? "all" : facility ?? location ?? "");
  }, [facility, location, remember]);
  return children(params);
}

/** Unscoped pages do not manufacture scope from unrelated URL parameters. */
export function OwnerNavigationScope({ pathname, children }: Props) {
  const memory = useContext(ScopeMemory);
  const operation = ["/owner/schedule", "/owner/sessions", "/owner/batches"].some(
    prefix => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (isFacilityScopedPath(pathname) || operation) return <ScopedQuery pathname={pathname}>{children}</ScopedQuery>;
  return children(memory?.value === null || memory == null ? empty : new URLSearchParams({ facility: memory.value }));
}
