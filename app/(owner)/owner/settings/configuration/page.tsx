import Link from "next/link";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import { requireOwner } from "@/lib/auth/surface-guard";
import { listOwnerVisibleConfigAction } from "@/lib/actions/owner-config";
import { OwnerConfigForm } from "@/components/owner-config-form";

// O-07 (docs/ops-platform-design.md §4) — the registry-rendered owner
// settings page. Every key the owner may see is listed here from the
// same catalogue the ops console reads; owner_edit keys are editable,
// owner_read keys offer a change request.

export default async function OwnerConfigurationPage() {
  await requireOwner();
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.read");
  const items = await listOwnerVisibleConfigAction();

  return (
    <main className="px-5 pt-6 pb-8">
      <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
        <Link
          href="/owner/settings"
          className="hover:text-ink underline-offset-2 hover:underline"
        >
          Settings
        </Link>
        {" / "}
        configuration
      </p>
      <h1 className="font-display text-[19px] font-semibold mt-2">
        Configuration
      </h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        How this academy works, resolved from the platform defaults, your
        plan and anything set just for you. Settings the platform controls
        can be changed with a request.
      </p>

      {items.length === 0 ? (
        <p className="mt-6 rounded-card bg-paper border border-line px-4 py-4 text-[13px] text-ink-3">
          Nothing is configurable here yet.
        </p>
      ) : (
        <div className="mt-5">
          <OwnerConfigForm
            items={items.map((item) => ({
              ...item,
              source: {
                ...item.source,
                setAt: item.source.setAt
                  ? new Date(item.source.setAt).toISOString()
                  : null,
              },
            }))}
          />
        </div>
      )}
    </main>
  );
}
