import { OpsCardFlush } from "@/components/ops/ops-primitives";

// Ops redesign (28 October 2026) — the permission matrix.
//
// Every role the platform knows, with the permissions it grants. It is
// the answer to "why can't the coach see Reports?" — and it is the
// same matrix the tenant workspace enforces, read from the same
// source, so the console cannot drift from the product.

export type PermissionRole = {
  key: string;
  name: string;
  homePath: string;
  permissions: readonly string[];
};

export function PermissionMatrix({ roles }: { roles: readonly PermissionRole[] }) {
  return (
    <OpsCardFlush>
      {roles.map((role) => (
        <details
          key={role.key}
          className="border-b border-line px-4 py-3 last:border-b-0"
        >
          <summary className="cursor-pointer text-[13px] text-ink">
            <span className="font-medium">{role.name}</span>{" "}
            <span className="text-ink-3">
              ({role.key}) · home {role.homePath} · {role.permissions.length}{" "}
              permission{role.permissions.length === 1 ? "" : "s"}
            </span>
          </summary>
          {role.permissions.length === 0 ? (
            <p className="mt-2 text-[12px] text-ink-3">No permissions granted.</p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {role.permissions.map((permission) => (
                <li
                  key={permission}
                  className="rounded-ctl bg-deck px-2 py-0.5 font-mono text-[11px] text-ink-2"
                >
                  {permission}
                </li>
              ))}
            </ul>
          )}
        </details>
      ))}
    </OpsCardFlush>
  );
}
