import { requireLiveOwnerSettingsPage } from "@/lib/auth/owner-settings-page-guard";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { listOwnerVisibleConfigAction } from "@/lib/actions/owner-config";
import { OwnerConfigForm } from "@/components/owner-config-form";
import { OwnerSectionLinks } from "@/components/owner-ui/owner-section-links";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";
import { BackLink } from "@/components/ui/BackLink";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { buttonClasses } from "@/components/ui/Button";
import { SettingsReadError } from "@/components/settings/settings-states";

// O-07 (docs/ops-platform-design.md §4) — the registry-rendered owner
// settings page. Every key the owner may see is listed here from the
// same catalogue the ops console reads; owner_edit keys are editable,
// owner_read keys offer a change request.

export default async function OwnerConfigurationPage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "settings.manage");
  await requireLiveOwnerSettingsPage(ctx);

  const items = await listOwnerVisibleConfigAction().catch(() => null);

  return (
    <OwnerPage workflow="settings">
      <BackLink href="/owner/settings" label="Settings" />
      <PageHeader
        title={<>Academy rules</>}
        purpose={<>How this academy works, resolved from the platform defaults, your
        plan and anything set just for you. Settings the platform controls
        can be changed with a request.</>}
      />

      {items?.length ? <OwnerSectionLinks label="Academy rule sections" className="mt-3" sections={[
        { id: "settings-notifications-title", label: "Notifications" },
        { id: "effective-rule-settings", label: "Effective rules" },
      ]} /> : null}
      <section id="notifications" aria-labelledby="settings-notifications-title" className="mt-5 max-w-2xl rounded-card border border-line bg-paper p-4 sm:p-5">
        <h2 id="settings-notifications-title" tabIndex={-1} className="font-display text-[16px] font-semibold text-ink">Notifications</h2>
        <p className="mt-1 text-[13px] text-ink-2">Choose when missed sessions trigger an alert.</p>
        <Link href="/owner/settings/alerts" className={buttonClasses({ variant: "secondary", className: "mt-3" })}>
          Absence alerts
        </Link>
      </section>

      {items === null ? (
        <SettingsReadError
          message="Could not load the academy rules. Nothing was changed."
          retryHref="/owner/settings/configuration"
        />
      ) : items.length === 0 ? (
        <p className="mt-6 rounded-card bg-paper border border-line px-4 py-4 text-[13px] text-ink-3">
          Nothing is configurable here yet.
        </p>
      ) : (
        <section className="mt-5 max-w-2xl rounded-card border border-line bg-paper p-4 sm:p-5">
          <h2 id="effective-rule-settings" tabIndex={-1} className="font-display text-[16px] font-semibold text-ink">
            Effective rules
          </h2>
          <p className="mt-0.5 text-[12.5px] text-ink-3">
            {items.length} effective {items.length === 1 ? "rule" : "rules"}.
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
