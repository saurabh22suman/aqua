"use client";

import { useEffect, useRef, useState } from "react";
import { loadFacilitySchemas } from "@/components/settings/facility-billing-validation-loader";

export function useFacilityValidation(onLoadFailure: () => void) {
  const active = useRef(false);
  const mounted = useRef(true);
  const [checking, setChecking] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function run(task: (schemas: Awaited<ReturnType<typeof loadFacilitySchemas>>) => void | Promise<void>) {
    if (active.current) return;
    active.current = true;
    setChecking(true);
    try {
      let schemas: Awaited<ReturnType<typeof loadFacilitySchemas>>;
      try { schemas = await loadFacilitySchemas(); }
      catch { if (mounted.current) onLoadFailure(); return; }
      if (!mounted.current) return;
      if (mounted.current) setChecking(false);
      await task(schemas);
    } finally {
      setChecking(false);
      active.current = false;
    }
  }

  async function runDirect(task: () => Promise<void>) {
    if (active.current) return;
    active.current = true;
    try { await task(); } finally { active.current = false; }
  }

  return { checking, run, runDirect };
}
