"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import {
  AriaComponent,
  GridComponent,
  TitleComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { formatINR, formatINRCompact } from "@/lib/money/format";
import { compactPaiseINR } from "@/lib/dashboard-charts";

// Owner Home chart island. ECharts is imported modularly (bar, line, pie,
// grid, tooltip, title, aria, canvas) and loaded lazily at lg+ only —
// below that breakpoint the panels render their accessible data tables,
// so a phone never downloads the chart engine (DESIGN.md §5).
//
// Colour carries data: Cash = water, Digital = marine, Other = muted
// ink. The doughnut's centre states the selected period's total so the
// ring does not need a separate legend to be understood.

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  TitleComponent,
  AriaComponent,
  CanvasRenderer,
]);

function tokenColor(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export type OwnerBar = {
  label: string;
  fullLabel: string;
  cash: number;
  digital: number;
  other: number;
  total: number;
};

export type OwnerLine = {
  label: string;
  fullLabel: string;
  pct: number | null;
  present: number;
  total: number;
};

export type OwnerSlice = { key: string; label: string; paise: number };

export type OwnerChartProps =
  | { kind: "stacked"; buckets: OwnerBar[]; ariaLabel: string }
  | { kind: "line"; buckets: OwnerLine[]; ariaLabel: string }
  | { kind: "doughnut"; groups: OwnerSlice[]; totalPaise: number; ariaLabel: string };

export default function OwnerChart(props: OwnerChartProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const water = tokenColor("--color-water", "#0e7c86");
    const marine = tokenColor("--color-marine", "#0d3b36");
    const ink = tokenColor("--color-ink", "#0f1f1c");
    const ink3 = tokenColor("--color-ink-3", "#5b6f6b");
    const line = tokenColor("--color-line", "rgba(15,31,28,.10)");
    const paper = tokenColor("--color-paper", "#ffffff");
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animation = !reduceMotion;
    const animationDuration = reduceMotion ? 0 : 150;

    let chart: ReturnType<typeof echarts.init> | null = null;
    const build = () => {
      if (chart || el.clientWidth === 0 || el.clientHeight === 0) return;
      chart = echarts.init(el, null, { renderer: "canvas" });

      if (props.kind === "stacked") {
        chart.setOption({
          animation,
          animationDuration,
          aria: { enabled: true, description: props.ariaLabel },
          grid: { top: 8, right: 8, bottom: 26, left: 50 },
          tooltip: {
            trigger: "axis",
            confine: true,
            formatter: (params: unknown) => {
              const items = Array.isArray(params) ? params : [];
              const index = (items[0] as { dataIndex?: number } | undefined)?.dataIndex;
              const bucket = typeof index === "number" ? props.buckets[index] : undefined;
              if (!bucket) return "";
              return [
                `<strong>${bucket.fullLabel}</strong>`,
                `Cash: ${formatINR(bucket.cash)}`,
                `Digital: ${formatINR(bucket.digital)}`,
                `Other: ${formatINR(bucket.other)}`,
                `Total: ${formatINR(bucket.total)}`,
              ].join("<br/>");
            },
          },
          xAxis: {
            type: "category",
            data: props.buckets.map((bucket) => bucket.label),
            axisLine: { lineStyle: { color: line } },
            axisTick: { show: false },
            axisLabel: { color: ink3, fontSize: 11, hideOverlap: true },
          },
          yAxis: {
            type: "value",
            splitLine: { lineStyle: { color: line } },
            axisLabel: {
              color: ink3,
              fontSize: 11,
              formatter: (value: number) => compactPaiseINR(value),
            },
          },
          series: [
            stacked("Cash", "cash", water, paper, props.buckets),
            stacked("Digital", "digital", marine, paper, props.buckets),
            stacked("Other", "other", ink3, paper, props.buckets),
          ],
        });
      } else if (props.kind === "line") {
        chart.setOption({
          animation,
          animationDuration,
          aria: { enabled: true, description: props.ariaLabel },
          grid: { top: 8, right: 10, bottom: 26, left: 38 },
          tooltip: {
            trigger: "axis",
            confine: true,
            formatter: (params: unknown) => {
              const items = Array.isArray(params) ? params : [];
              const index = (items[0] as { dataIndex?: number } | undefined)?.dataIndex;
              const bucket = typeof index === "number" ? props.buckets[index] : undefined;
              if (!bucket) return "";
              if (bucket.pct === null) return `${bucket.fullLabel}<br/>No marks recorded`;
              return `${bucket.fullLabel}<br/>${bucket.pct}% (${bucket.present} of ${bucket.total} marks)`;
            },
          },
          xAxis: {
            type: "category",
            data: props.buckets.map((bucket) => bucket.label),
            axisLine: { lineStyle: { color: line } },
            axisTick: { show: false },
            axisLabel: { color: ink3, fontSize: 11, hideOverlap: true },
          },
          yAxis: {
            type: "value",
            min: 0,
            max: 100,
            splitLine: { lineStyle: { color: line } },
            axisLabel: { color: ink3, fontSize: 11, formatter: "{value}%" },
          },
          series: [
            {
              name: "Attendance",
              type: "line",
              data: props.buckets.map((bucket) => bucket.pct),
              connectNulls: false,
              showSymbol: true,
              symbolSize: 5,
              lineStyle: { color: water, width: 2 },
              itemStyle: { color: water },
            },
          ],
        });
      } else {
        chart.setOption({
          animation,
          animationDuration,
          aria: { enabled: true, description: props.ariaLabel },
          title: {
            text: formatINRCompact(props.totalPaise),
            subtext: "collected",
            left: "center",
            top: "40%",
            textStyle: { color: ink, fontSize: 18, fontWeight: 600 },
            subtextStyle: { color: ink3, fontSize: 11 },
          },
          tooltip: {
            trigger: "item",
            confine: true,
            formatter: (params: unknown) => {
              const item = params as { name?: string; value?: number };
              return `${item.name ?? ""}: ${formatINR(Number(item.value ?? 0))}`;
            },
          },
          series: [
            {
              type: "pie",
              radius: ["58%", "82%"],
              center: ["50%", "50%"],
              label: { show: false },
              itemStyle: { borderColor: paper, borderWidth: 2 },
              data: props.groups.map((group) => ({
                name: group.label,
                value: group.paise,
                itemStyle: {
                  color:
                    group.key === "cash" ? water : group.key === "digital" ? marine : ink3,
                },
              })),
            },
          ],
        });
      }
    };

    build();
    const onResize = () => chart?.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart?.dispose();
      chart = null;
    };
  }, [props]);

  return (
    <div
      ref={ref}
      style={{ height: 210, width: "100%" }}
      data-testid="owner-chart"
    />
  );
}

function stacked(
  name: string,
  key: "cash" | "digital" | "other",
  color: string,
  paper: string,
  buckets: OwnerBar[],
) {
  return {
    name,
    type: "bar" as const,
    stack: "collections",
    barMaxWidth: 26,
    itemStyle: { color, borderColor: paper, borderWidth: 1 },
    data: buckets.map((bucket) => bucket[key]),
  };
}
