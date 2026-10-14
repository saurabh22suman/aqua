"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { EchartsTrendProps } from "./echarts-trend";

// Mount gate for the ECharts island. The chart library is only pulled
// into the browser at lg+ — below the breakpoint the server-rendered
// SVG stays in charge, so a phone never downloads the chart chunk
// (DESIGN.md §5). The chunk itself is an async dynamic import, not
// part of any route's first-load JS (scripts/check-bundle-budget.ts).
const EchartsTrend = dynamic(() => import("./echarts-trend"), {
  ssr: false,
  loading: () => (
    <div
      style={{ height: 190 }}
      className="w-full animate-pulse rounded-ctl bg-deck"
    />
  ),
});

export function EchartsIsland(props: EchartsTrendProps) {
  const [desktop, setDesktop] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => setDesktop(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  if (!desktop) return null;
  return <EchartsTrend {...props} />;
}
