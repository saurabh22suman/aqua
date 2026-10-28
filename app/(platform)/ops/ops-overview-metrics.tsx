import type { ReactNode } from "react";
import ArrowDown from "lucide-react/dist/esm/icons/arrow-down.mjs";
import ArrowUp from "lucide-react/dist/esm/icons/arrow-up.mjs";
import Building2 from "lucide-react/dist/esm/icons/building-2.mjs";
import ClipboardList from "lucide-react/dist/esm/icons/clipboard-list.mjs";
import Clock from "lucide-react/dist/esm/icons/clock.mjs";
import TriangleAlert from "lucide-react/dist/esm/icons/triangle-alert.mjs";
import {
  OpsKpi,
  type OpsKpiChipTone,
  type OpsKpiSurface,
} from "@/components/ops/ops-display";

// Ops redesign (28 October 2026) — the Overview's metric strip.
//
// The four summary tiles, as their own small server component: the
// page keeps the live queue, the activity and the auth, and this file
// keeps the figures and how they are dressed.
//
// THE SURFACES (DESIGN.md §1.4b). The tiles carry the OWNER's subtle
// pastel language, using the tokens that already exist:
//
//   Active tenants → tile-money   (a calm mint surface)
//   On trial       → tile-butter  (a restrained trial/time context)
//   At risk        → late-soft    (ONLY while there IS a risk)
//   Open ops tasks → tile-info    (powder blue in Mint, pale lilac in
//                                   Lavender Club)
//
// The surface GROUPS information; it never carries the meaning. The
// label and the number are the authoritative text, and the icon chip
// carries the state.
//
// CALM ZERO. A risk count of zero is a calm fact, not an alarm: the
// tile keeps the neutral paper surface, the chip keeps a neutral ink,
// the figure does not wear the late ink, and the copy says so in
// words. The late surface is only for a real problem.
//
// THE ORDER IS FIXED — Active tenants, On trial, At risk, Open ops
// tasks — so a figure never moves when the theme changes or the data
// refreshes.

/** One figure and its comparison, as the snapshot provides them. */
export type OverviewMetricDelta = {
  current: number;
  previous: number | null;
};

export type OpsOverviewMetricsProps = {
  activeTenants: OverviewMetricDelta;
  trialTenants: OverviewMetricDelta;
  atRiskTenants: OverviewMetricDelta;
  openOpsTasks: OverviewMetricDelta;
};

export function OpsOverviewMetrics({
  activeTenants,
  trialTenants,
  atRiskTenants,
  openOpsTasks,
}: OpsOverviewMetricsProps) {
  // A risk count of ZERO is a calm fact, not an alarm.
  const riskPositive = atRiskTenants.current > 0;

  return (
    <section className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard
        label="Active tenants"
        delta={activeTenants}
        surface="money"
        icon={<Building2 size={18} strokeWidth={1.8} />}
        chipTone="water"
      />
      <KpiCard
        label="On trial"
        delta={trialTenants}
        surface="butter"
        icon={<Clock size={18} strokeWidth={1.8} />}
        chipTone="marine"
      />
      <KpiCard
        label="At risk"
        delta={atRiskTenants}
        surface={riskPositive ? "late" : "paper"}
        icon={<TriangleAlert size={18} strokeWidth={1.8} />}
        chipTone={riskPositive ? "late" : "neutral"}
        valueTone={riskPositive ? "late" : undefined}
        extraNote={riskPositive ? null : "No tenant is at risk."}
      />
      <KpiCard
        label="Open ops tasks"
        delta={openOpsTasks}
        surface="info"
        icon={<ClipboardList size={18} strokeWidth={1.8} />}
        chipTone="water"
      />
    </section>
  );
}

function KpiCard({
  label,
  delta,
  surface,
  icon,
  chipTone,
  valueTone,
  extraNote,
}: {
  label: string;
  delta: OverviewMetricDelta;
  /** The pastel surface (DESIGN.md §1.4b). */
  surface: OpsKpiSurface;
  /** A decorative icon for the 32px chip. */
  icon: ReactNode;
  /** The chip's ink. */
  chipTone: OpsKpiChipTone;
  /** The figure's ink, when the figure itself is a real problem. */
  valueTone?: "late";
  /** An extra line under the delta — e.g. a calm zero's wording. */
  extraNote?: ReactNode;
}) {
  return (
    <OpsKpi
      label={label}
      value={delta.current}
      surface={surface}
      icon={icon}
      chipTone={chipTone}
      valueTone={valueTone}
      note={
        <>
          <DeltaLine label={label} delta={delta} />
          {extraNote ? <p className="mt-0.5">{extraNote}</p> : null}
        </>
      }
    />
  );
}

/**
 * The comparison line under a figure.
 *
 * The delta is the snapshot's own comparison — the latest snapshot
 * against the latest snapshot that is at least a month old. With no
 * such snapshot there is simply no comparison, and the line says so
 * rather than inventing one.
 */
function DeltaLine({
  label,
  delta,
}: {
  label: string;
  delta: OverviewMetricDelta;
}) {
  if (delta.previous == null) {
    return (
      <p className="mt-1 text-[12px] text-ink-3">{label} — no comparison yet</p>
    );
  }
  const diff = delta.current - delta.previous;
  if (diff === 0) {
    return <p className="mt-1 text-[12px] text-ink-3">No change from last month</p>;
  }
  const Icon = diff > 0 ? ArrowUp : ArrowDown;
  return (
    <p className="mt-1 flex items-center gap-1 text-[12px] text-ink-3">
      <Icon size={11} strokeWidth={2.5} aria-hidden="true" />
      {diff > 0 ? "+" : ""}
      {diff} from last month
    </p>
  );
}
