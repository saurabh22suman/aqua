"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Personal, device-local presentation preference; no setup data is stored. */
export function SetupDisclosure({ complete, namespace, children }: {complete:boolean; namespace:string; children:ReactNode}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const key = `aqua:setup-dismissed:${namespace}`;
  useEffect(() => {
    if (!ref.current) return;
    try { ref.current.open = !complete && localStorage.getItem(key) !== "1"; }
    catch { ref.current.open = !complete; }
  }, [complete,key]);
  return <details ref={ref} open={!complete} className="mt-5 rounded-card border border-line bg-paper p-4 sm:p-5">
    <summary className="min-h-11 cursor-pointer content-center font-display text-[16px] font-semibold text-ink focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]" onClick={() => {
      try { if (ref.current?.open) localStorage.setItem(key,"1"); else localStorage.removeItem(key); } catch { /* Preference is optional. */ }
    }}>Club setup</summary>
    {children}
  </details>;
}
