"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { OwnerChartProps } from "./echarts-owner";
import { useTheme } from "@/components/theme/theme-provider";

// Mount gate for the owner Home charts. The engine is pulled in only at
// lg+; below that the panels keep their server-rendered data tables, so
// a phone never downloads ECharts (DESIGN.md §5). The chunk is an async
// import, never part of a route's first-load JS.
const OwnerChart = dynamic(() => import("./echarts-owner"), {
  ssr: false,
  loading: () => (
    <div style={{ height: 210 }} className="w-full animate-pulse rounded-ctl bg-deck" />
  ),
});

export function OwnerChartIsland(props: OwnerChartProps) {
  const [desktop, setDesktop] = useState(false);
  const { theme } = useTheme();

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => setDesktop(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  if (!desktop) return null;
  // Canvas colours are resolved at draw time; remount when the preset
  // changes so the canvas follows the same palette as the SVG and legend.
  return <OwnerChart key={theme} {...props} />;
}
