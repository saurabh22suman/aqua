// Owner configuration display helpers, split out of
// components/owner-config-form.tsx to keep that module within the
// line budget. These are presentation-only mappings over the registry
// item shape; validation stays on the server.

export type OwnerConfigItem = {
  key: string;
  value: unknown;
  visibility: "owner_edit" | "owner_read";
  risk: string;
  description: string;
  jsonSchema: Record<string, unknown>;
  source: {
    scopeType: string;
    scopeId: string | null;
    setBy: string | null;
    setAt: string | null;
  };
  editable: boolean;
};

export const KEY_TITLES: Record<string, string> = {
  "attendance.absence_alert_threshold_pct": "Absence alert threshold",
  "access.location_scoped_staff": "Staff location access",
  "operations.business_hours": "Business hours",
  "bookings.advance_window_days": "Booking advance window",
};

export function valueType(item: OwnerConfigItem): string {
  const type = item.jsonSchema["type"];
  return typeof type === "string" ? type : "string";
}

export function isStructured(item: OwnerConfigItem): boolean {
  const type = valueType(item);
  return type === "object" || type === "array";
}

export function toInputValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null || value === undefined) return "";
  return String(value);
}

export function fromInputValue(item: OwnerConfigItem, raw: string): unknown {
  const type = valueType(item);
  if (type === "boolean") return raw === "true";
  if (type === "integer" || type === "number") return Number(raw);
  return raw;
}

export function scopeLabel(item: OwnerConfigItem): string {
  switch (item.source.scopeType) {
    case "default":
      return "platform default";
    case "platform":
      return "set by Aqua";
    case "plan":
      return "included in your plan";
    case "preset":
      return "from your sports preset";
    case "tenant":
      return "set for this academy";
    case "location":
      return "set at a location";
    case "activity":
      return "set on an activity";
    default:
      return "platform default";
  }
}

const DAY_LABELS: Record<string, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

type BusinessHours = {
  days?: Array<{ day: string; closed: boolean; open: string; close: string }>;
};

function describeBusinessHours(value: unknown): string {
  const hours = (value ?? {}) as BusinessHours;
  const days = Array.isArray(hours.days) ? hours.days : [];
  if (days.length === 0) return "Not configured yet.";
  return days
    .map(
      (d) =>
        `${DAY_LABELS[d.day] ?? d.day} ${d.closed ? "closed" : `${d.open}–${d.close}`}`,
    )
    .join(" · ");
}

// Human summary for any structured value. Known keys get a purpose
// built summary; anything else gets an honest shape description
// instead of a stringified object.
export function describeStructured(item: OwnerConfigItem): string {
  if (item.key === "operations.business_hours") {
    return describeBusinessHours(item.value);
  }
  if (Array.isArray(item.value)) {
    return `${item.value.length} item${item.value.length === 1 ? "" : "s"} configured.`;
  }
  if (item.value && typeof item.value === "object") {
    const count = Object.keys(item.value as object).length;
    return `${count} field${count === 1 ? "" : "s"} configured.`;
  }
  return "Not configured yet.";
}

export function readOnlyValue(item: OwnerConfigItem): string {
  if (typeof item.value === "boolean") return item.value ? "On" : "Off";
  if (isStructured(item)) return describeStructured(item);
  if (item.value === null || item.value === undefined) return "—";
  return String(item.value);
}
