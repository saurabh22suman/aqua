import Link from "next/link";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { listOwnerVisibleConfigAction } from "@/lib/actions/owner-config";
import { OwnerConfigForm } from "@/components/owner-config-form";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";

// O-07 (docs/ops-platform-design.md §4) — the registry-rendered owner
// settings page. Every key the owner may see is listed here from the
// same catalogue the ops console reads; owner_edit keys are editable,
// owner_read keys offer a change request.

export default async function OwnerConfigurationPage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "settings.manage");

  const items = await listOwnerVisibleConfigAction();

  return (
    <OwnerPage>
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
      <PageHeader
        title={<>Academy rules</>}
        purpose={<>How this academy works, resolved from the platform defaults, your
        plan and anything set just for you. Settings the platform controls
        can be changed with a request.</>}
      />

      {items.length === 0 ? (
        <p className="mt-6 rounded-card bg-paper border border-line px-4 py-4 text-[13px] text-ink-3">
          Nothing is configurable here yet.
        </p>
      ) : (
        <section className="mt-5 rounded-card border border-line bg-paper p-5">
          <h2 className="font-display text-[16px] font-semibold text-ink">
            Effective rules
          </h2>
          <p className="mt-0.5 text-[12.5px] text-ink-3">
            Human-readable values, their scope, and who can change them.
          </p>
          <div className="mt-2">
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
        </section>
      )}
    </OwnerPage>
  );
}
