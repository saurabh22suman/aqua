import Link from "next/link";
import { KhelIcon, type KhelIconName } from "@/components/icons/khel-icons";
import {
  opsNavGroupsForRole,
  type OpsNavigationRole,
} from "@/components/ops/ops-nav-items";

// Ops completion (9 November 2026) — the Overview's task list.
//
// The Overview used to carry a flat grid of five "quick action" cards,
// each with its own description and no relation to anything else on the
// page — the scattered-information complaint in one component.
//
// The task list is now grouped by the SAME task groups the rail uses,
// and every destination's NAME comes from the same registry, so the
// Overview and the rail speak one vocabulary. The purpose line under a
// destination is the only extra copy: one line, secondary, and kept
// from the existing copy.
//
// The set of destinations is unchanged: the five the Overview already
// offered. The WhatsApp row appears only when the mock provider is the
// active one, exactly as the old quick-action grid did — a production
// console must not offer a screen that 404s there.

const TASK_DETAILS: Record<string, string> = {
  "/ops/tenants":
    "List every tenant, drill into settings, suspend or churn.",
  "/ops/leads":
    "Sales pipeline: qualification answers become the tenant’s preset and configuration.",
  "/ops/features": "Editable list of every feature Aqua ships.",
  "/ops/presets": "Apply a feature and vocabulary preset to a tenant.",
  "/ops/whatsapp":
    "Non-production: send and receive mock messages through the real pipeline.",
};

// The destination's glyph, from the shared Khel icon family. The
// glyph is decorative — the row's NAME carries the meaning — so it is
// hidden from assistive technology.
const TASK_ICONS: Record<string, KhelIconName> = {
  "/ops/tenants": "tenants",
  "/ops/leads": "enquiries",
  "/ops/features": "audit-activity",
  "/ops/presets": "settings",
  "/ops/whatsapp": "announcements",
};

export function OpsTaskList({
  role,
  includeWhatsApp = false,
}: {
  /** The server-verified role; it grants no access. */
  role: OpsNavigationRole;
  /** True when the mock messaging provider is the active one. */
  includeWhatsApp?: boolean;
}) {
  const groups = opsNavGroupsForRole(role)
    // The Overview IS the overview; it does not list itself.
    .filter((group) => group.id !== "overview")
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (!TASK_DETAILS[item.href]) return false;
        if (item.href === "/ops/whatsapp" && !includeWhatsApp) return false;
        return true;
      }),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const labelId = `ops-task-group-${group.id}`;
        return (
          <div key={group.id}>
            <p
              id={labelId}
              className="mb-1.5 text-[11px] uppercase tracking-[0.14em] text-ink-3"
            >
              {group.label}
            </p>
            <ul aria-labelledby={labelId} className="space-y-2">
              {group.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="flex items-start gap-2.5 rounded-card border border-line bg-paper p-3 transition-colors duration-150 hover:border-[var(--accent-strong)]"
                  >
                    <span
                      className="mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-ctl bg-deck text-ink-2"
                    >
                      <KhelIcon name={TASK_ICONS[item.href]} size={20} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium text-ink">
                        {item.label}
                      </span>
                      <span className="mt-0.5 block text-[12px] text-ink-3">
                        {TASK_DETAILS[item.href]}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
