"use client";

import { useRouter } from "next/navigation";

// PR5 (ops console improvements) — effective-configuration was fixed
// by URL; switching tenants meant going back to the tenants list.
// Preserves the current role/key selection across the switch so a
// support call ("why can't the coach see X for tenant Y") doesn't
// lose its place.
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
    <label className="block">
      <span className="block text-[12px] font-medium text-ink-2 mb-1">Tenant</span>
      <select
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
        className="rounded-ctl border border-line bg-paper px-3 py-1.5 text-[13px] text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
      >
        {tenants.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} ({t.slug})
          </option>
        ))}
      </select>
    </label>
  );
}
