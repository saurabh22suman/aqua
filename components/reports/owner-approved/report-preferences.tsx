"use client";

import { useEffect, useState, type ReactNode } from "react";
import { OwnerIcon, type OwnerIconName } from "@/components/owner-ui/owner-icon";
import { Switch } from "@/components/ui/Switch";
import { defaultReportPreferences, readReportPreferences, writeReportPreferences, type ReportFamily, type ReportPreferenceIdentity, type ReportPreferences } from "@/lib/owner-reports/preferences";

// The report-visibility switches draw the shared Owner outline set
// (Foundation owns the geometry). The approved mock has exact glyphs for
// members, staff and money; an attendance report is a list of marked
// sessions, which is what the mock's `programs` list glyph draws, and the
// batches report is the same list of scheduled groups — both mappings are
// documented here rather than silently substituting other imagery.
const FAMILY_ICON: Record<ReportFamily, OwnerIconName> = {
  attendance: "programs",
  members: "members",
  staff: "staff",
  batches: "programs",
  collections: "money",
};

const items = [
  { family: "attendance", label: "Attendance" },
  { family: "members", label: "Members" },
  { family: "staff", label: "Staff" },
  { family: "batches", label: "Batches" },
  { family: "collections", label: "Collections" },
] as const;

function useReportPreferences(identity: ReportPreferenceIdentity) {
  const [preferences, setPreferences] = useState<ReportPreferences>(defaultReportPreferences);
  const [failed, setFailed] = useState(false);
  const { tenantId, userId } = identity;
  useEffect(() => {
    const load = () => setPreferences(readReportPreferences({ tenantId, userId }));
    load();
    window.addEventListener("storage", load);
    window.addEventListener("aqua:report-preferences", load);
    return () => {
      window.removeEventListener("storage", load);
      window.removeEventListener("aqua:report-preferences", load);
    };
  }, [tenantId, userId]);
  function setFamily(family: ReportFamily, enabled: boolean) {
    const next = { ...preferences, [family]: enabled };
    setPreferences(next);
    setFailed(!writeReportPreferences({ tenantId, userId }, next));
  }
  return { preferences, failed, setFamily };
}

export function ReportPreferencesEditor({ identity, available, labels }: { identity: ReportPreferenceIdentity; available: readonly ReportFamily[]; labels?: Partial<Record<ReportFamily, string>> }) {
  const { preferences, failed, setFamily } = useReportPreferences(identity);
  return <section aria-label="Report display" className="mt-5 max-w-2xl rounded-card border border-line bg-paper px-4 py-3">
    <p className="text-sm text-ink-2">Choose cards on Reports. Personal to you on this device; access does not change.</p>
    <div className="mt-2 divide-y divide-line">
      {items.filter(item => available.includes(item.family)).map(({ family, label }) => <div key={family} className="flex min-h-14 items-center gap-3">
        <OwnerIcon name={FAMILY_ICON[family]} size={19} className="shrink-0 text-ink-3" />
        <Switch label={labels?.[family] ?? label} checked={preferences[family]} onCheckedChange={enabled => setFamily(family, enabled)} className="flex-1 flex-row-reverse justify-between" />
      </div>)}
    </div>
    {failed ? <p role="status" className="mt-3 text-sm text-ink-2">This device could not save your choice. Try again when storage is available.</p> : null}
  </section>;
}

/** Presentation only: caller supplies server-authorized families; this is not an authorization boundary. */
export function ReportPreferenceFilter({ identity, available, family, children }: { identity: ReportPreferenceIdentity; available: readonly ReportFamily[]; family: ReportFamily; children: ReactNode }) {
  const { preferences } = useReportPreferences(identity);
  return available.includes(family) && preferences[family] ? <>{children}</> : null;
}

export function ReportPreferencesEmpty({ identity, available }: { identity: ReportPreferenceIdentity; available: readonly ReportFamily[] }) {
  const { preferences } = useReportPreferences(identity);
  if (available.length === 0 || available.some(family => preferences[family])) return null;
  return <p className="mt-4 rounded-card border border-line bg-paper p-4 text-sm text-ink-2"><span>No report cards selected</span>. Use Customize reports above to show them.</p>;
}
