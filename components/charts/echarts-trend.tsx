"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import {
  AriaComponent,
  GridComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { formatINR } from "@/lib/money/format";
import {
  compactPaiseINR,
  formatDrillHref,
  type DashboardTrendPoint,
} from "@/lib/dashboard-charts";

// Owner dashboard chart island. Loaded only at lg+ (see
// echarts-island.tsx), tree-shaken to line + bar + tooltip + grid +
// aria, and coloured from the design tokens at runtime — the canvas
// can't read Tailwind classes, so the tokens are resolved from
// :root rather than hard-coded here (DESIGN.md §6: never a raw hex).
echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, AriaComponent, CanvasRenderer]);

function tokenColor(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export type EchartsTrendProps = {
  points: DashboardTrendPoint[];
  kind: "line" | "bar";
  format: "percent" | "currency";
  ariaLabel: string;
  drill?: string;
};

export default function EchartsTrend({
  points,
  kind,
  format,
  ariaLabel,
  drill,
}: EchartsTrendProps) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const el = ref.current;
    if (!el || points.length === 0) return;

    const water = tokenColor("--color-water", "#0e7c86");
    const line = tokenColor("--color-line", "#e2e8f0");
    const ink3 = tokenColor("--color-ink-3", "#64748b");
    const dates = points.map((p) => p.date);
    const values = points.map((p) => p.value);
    const showSymbol = kind === "line";

    // Defer init until the container has real dimensions: ECharts
    // logs "Can't get DOM width or height" and renders nothing when
    // initialised at 0×0 (seen while a Tailwind class was missing).
    // The observer both waits for first layout and drives resizes.
    let chart: ReturnType<typeof echarts.init> | null = null;
    const build = () => {
      if (chart || el.clientWidth === 0 || el.clientHeight === 0) return;
      chart = echarts.init(el, null, { renderer: "canvas" });
      chart.setOption({
        animationDuration: 150,
        aria: { enabled: true, description: ariaLabel },
        grid: { top: 8, right: 8, bottom: 24, left: format === "currency" ? 46 : 34 },
        tooltip: {
          trigger: "axis",
          confine: true,
          valueFormatter: (value: unknown) =>
            format === "currency" ? formatINR(Number(value ?? 0)) : `${value ?? "—"}%`,
        },
        xAxis: {
          type: "category",
          data: dates,
          axisLine: { lineStyle: { color: line } },
          axisTick: { show: false },
          axisLabel: { color: ink3, fontSize: 11, hideOverlap: true },
        },
        yAxis: {
          type: "value",
          max: format === "percent" ? 100 : undefined,
          splitLine: { lineStyle: { color: line } },
          axisLabel: {
            color: ink3,
            fontSize: 11,
            formatter: (value: number) =>
              format === "currency" ? compactPaiseINR(value) : `${value}%`,
          },
        },
        series: [
          {
            type: kind,
            data: values,
            showSymbol,
            symbolSize: 6,
            lineStyle: { color: water, width: 2.5 },
            itemStyle: { color: water, borderRadius: kind === "bar" ? [3, 3, 0, 0] : 0 },
            barMaxWidth: 18,
            connectNulls: false,
          },
        ],
      });

      if (drill) {
        chart.on("click", (params) => {
          const date =
            typeof params.dataIndex === "number" ? dates[params.dataIndex] : undefined;
          if (date) router.push(formatDrillHref(drill, date));
        });
        el.style.cursor = "pointer";
      }
    };

    build();
    const resize = new ResizeObserver(() => {
      if (chart) chart.resize();
      else build();
    });
    resize.observe(el);
    return () => {
      resize.disconnect();
      chart?.dispose();
    };
  }, [points, kind, format, ariaLabel, drill, router]);

  return (
    <div
      ref={ref}
      role="img"
      aria-label={ariaLabel}
      data-testid="echarts-trend"
      style={{ height: 190 }}
      className="w-full"
    />
  );
}
