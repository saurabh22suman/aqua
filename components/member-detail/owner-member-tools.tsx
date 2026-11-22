"use client";

import { createContext, useContext, useState, type ComponentProps, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { MakeupCreditsPanel } from "@/components/makeup-credits-panel";

const OpenedContext = createContext(false);
const LazyMakeupCreditsPanel = dynamic(
  () => import("@/components/makeup-credits-panel").then((module) => module.MakeupCreditsPanel),
  { ssr: false, loading: () => <p role="status" className="text-[13px] text-ink-3">Loading makeup credits…</p> },
);

export function OwnerMemberTools({ label, children }: { label: string; children: ReactNode }) {
  const [opened, setOpened] = useState(false);
  return <details className="rounded-[18px] border border-line bg-paper p-4" onToggle={(event) => { if (event.currentTarget.open) setOpened(true); }}>
    <summary className="min-h-11 cursor-pointer font-display text-[15px] font-semibold text-ink">{label}</summary>
    <OpenedContext.Provider value={opened}>{children}</OpenedContext.Provider>
  </details>;
}

export function DeferredMakeupCreditsPanel(props: ComponentProps<typeof MakeupCreditsPanel>) {
  const opened = useContext(OpenedContext);
  return opened ? <LazyMakeupCreditsPanel {...props} /> : null;
}
