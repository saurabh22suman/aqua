"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/Select";

// PR5 (ops console improvements) — effective-configuration was fixed
// by URL; switching tenants meant going back to the tenants list.
// Preserves the current role/key selection across the switch so a
// support call ("why can't the coach see X for tenant Y") doesn't
// lose place.
//
// Ops redesign (28 October 2026): the picker is the SHARED Select, so
// it carries the standard control metrics and the tinted picker
// surface like every other control in the console.
export function TenantSelector({
  tenants,
  selectedTenantId,
  role,
  configKey,
}: {
  tenants: ReadonlyArray<{ id: string; name: string; slug: string }>;
  selectedTenantId: string;
  role?: string;
  configKey?: string;
}) {
  const router = useRouter();

  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[12px] font-medium text-ink-2">Tenant</span>
      <Select
        data-testid="ops-tenant-selector"
        value={selectedTenantId}
        onChange={(e) => {
          const params = new URLSearchParams();
          if (role) params.set("role", role);
          if (configKey) params.set("key", configKey);
          const qs = params.toString();
          router.push(
            `/ops/tenants/${e.target.value}/configuration${qs ? `?${qs}` : ""}`,
          );
        }}
      >
        {tenants.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} ({t.slug})
          </option>
        ))}
      </Select>
    </label>
  );
}
