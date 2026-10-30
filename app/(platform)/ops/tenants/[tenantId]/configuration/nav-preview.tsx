import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { OpsEmptyState } from "@/components/ops/ops-primitives";

// Ops redesign (28 October 2026) — the nav preview.
//
// The tenant navigation each role would see, with the entries a
// feature switch hides struck through. It answers "what does the coach
// actually get?" without switching accounts.
//
// The preview is READ-ONLY: it changes nothing. The role picker is a
// GET form, so the previewed role is part of the URL and the Back
// button returns to the previous one.

export type NavPreviewItem = {
  label: string;
  href: string;
  featureKey?: string;
};

export function NavPreview({
  roles,
  selectedRoleKey,
  navItems,
  entitledFeatureKeys,
}: {
  roles: ReadonlyArray<{ key: string; name: string }>;
  selectedRoleKey?: string;
  navItems: readonly NavPreviewItem[];
  /** The feature keys this tenant currently has. */
  entitledFeatureKeys: ReadonlySet<string>;
}) {
  return (
    <>
      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="block min-w-0">
          <span className="mb-1 block text-[12px] font-medium text-ink-2">
            Role
          </span>
          <Select id="role" name="role" defaultValue={selectedRoleKey}>
            {roles.map((role) => (
              <option key={role.key} value={role.key}>
                {role.name} ({role.key})
              </option>
            ))}
          </Select>
        </label>
        <Button type="submit" variant="secondary">
          Preview
        </Button>
      </form>
      {navItems.length === 0 ? (
        <OpsEmptyState
          className="mt-3"
          title="This role renders no tenant nav"
          body="The role has no tenant surface of its own."
        />
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {navItems.map((item) => {
            const gatedOut =
              item.featureKey !== undefined && !entitledFeatureKeys.has(item.featureKey);
            return (
              <span
                key={item.href}
                className={`rounded-ctl px-3 py-1.5 text-[12px] ${
                  gatedOut
                    ? "border border-line bg-paper text-ink-3 line-through"
                    : "bg-deck text-ink"
                }`}
              >
                {item.label}
                <span className="ml-2 font-mono text-[11px] text-ink-3">
                  {item.href}
                </span>
                {gatedOut ? (
                  <span className="ml-2 text-[11px] text-ink-3">
                    hidden — feature off
                  </span>
                ) : null}
              </span>
            );
          })}
        </div>
      )}
    </>
  );
}
