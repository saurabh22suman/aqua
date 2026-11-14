export const REPORT_FAMILIES = ["attendance", "members", "staff", "batches", "collections"] as const;
export type ReportFamily = (typeof REPORT_FAMILIES)[number];
export type ReportPreferences = Record<ReportFamily, boolean>;
export type ReportPreferenceIdentity = { tenantId: string; userId: string };

export function reportPreferenceKey(identity: ReportPreferenceIdentity): string {
  return `aqua:owner-report-preferences:${encodeURIComponent(identity.tenantId)}:${encodeURIComponent(identity.userId)}`;
}

export function defaultReportPreferences(): ReportPreferences {
  return { attendance: true, members: true, staff: true, batches: true, collections: true };
}

export function readReportPreferences(identity: ReportPreferenceIdentity): ReportPreferences {
  try {
    const raw = window.localStorage.getItem(reportPreferenceKey(identity));
    if (!raw) return defaultReportPreferences();
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return defaultReportPreferences();
    const record = value as Record<string, unknown>;
    if (!REPORT_FAMILIES.every(family => typeof record[family] === "boolean")) return defaultReportPreferences();
    return Object.fromEntries(REPORT_FAMILIES.map(family => [family, record[family]])) as ReportPreferences;
  } catch {
    return defaultReportPreferences();
  }
}

export function writeReportPreferences(identity: ReportPreferenceIdentity, value: ReportPreferences): boolean {
  try {
    window.localStorage.setItem(reportPreferenceKey(identity), JSON.stringify(value));
    window.dispatchEvent(new Event("aqua:report-preferences"));
    return true;
  } catch {
    return false;
  }
}
