import Link from "next/link";
import { OpsCardFlush, OpsEmptyState, OpsPage, OpsPageHeader, OpsPanel } from "@/components/ops/ops-primitives";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import type {
  FeatureEntitlement,
  MembershipDiagnostic,
} from "@/db/ops-diagnostics-view";

const DATETIME_FMT = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  invited: "Invited",
  revoked: "Revoked",
};

const STATUS_TONE: Record<string, StatusTone> = {
  active: "good",
  invited: "warn",
  revoked: "late",
};

const SOURCE_LABEL: Record<string, string> = {
  plan: "from the plan",
  tenant_override: "from a club override",
  denied: "turned off for this club",
};

/** The administrator-only refusal. It names no account fact. */
export function DiagnosticsRefusal() {
  return (
    <OpsPage>
      <OpsPageHeader
        eyebrow="Operator console"
        title="Administrator access required"
        lede="This account diagnostic view is limited to administrator accounts. Your platform account can browse the rest of the console, but it cannot open this view."
      />
      <OpsPanel tone="pending" className="mt-6" title="No membership data was read">
        The refusal happens before any membership data is read, so no account data
        was loaded for this request. The club&apos;s name and status above come from
        the tenant layout, which reads the club header for every tenant page.
      </OpsPanel>
    </OpsPage>
  );
}

/** What this page is, and what it is not. */
export function DiagnosticsScopeNotice() {
  return (
    <OpsPanel tone="pending" className="mt-6" title="What this view proves, and what it does not">
      It reads this club&apos;s own membership rows and reports the role, grants and
      recorded facilities. Owner destination badges reflect navigation role and
      feature gates; other surfaces&apos; destinations are not assessed here. Navigation
      does not prove access to every page or action, or that a person may act today.
      It does not show that anybody
      is signed in, it does not show a consent, and it does not show who owns a
      number — no contact detail is read at all. It never signs in as anybody and it
      changes nothing.
    </OpsPanel>
  );
}

/** The compact index of the club's memberships. */
export function DiagnosticsMembershipList({
  memberships,
  total,
  tenantId,
}: {
  memberships: MembershipDiagnostic[];
  total: number;
  tenantId: string;
}) {
  if (memberships.length === 0) {
    return (
      <OpsEmptyState
        title="This club has no staff memberships"
        body="There is no membership row to describe, so there is no account to diagnose."
      />
    );
  }
  return (
    <OpsCardFlush>
      {memberships.map((membership) => (
        <div
          key={membership.membershipId}
          className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-b-0"
        >
          <div className="min-w-0">
            <p className="font-mono text-[13px] text-ink">{membership.membershipId}</p>
            <p className="mt-0.5 text-[13px] text-ink-2">
              {membership.roleName}{" "}
              <span className="font-mono text-[12px] text-ink-3">({membership.roleKey})</span>
            </p>
          </div>
          <div className="flex flex-none items-center gap-3">
            <StatusBadge tone={STATUS_TONE[membership.status] ?? "neutral"}>
              {STATUS_LABEL[membership.status] ?? membership.status}
            </StatusBadge>
            <Link
              href={`/ops/tenants/${tenantId}/diagnostics?membership=${membership.membershipId}`}
              className="text-[13px] font-medium text-[var(--accent-ink)] underline underline-offset-2"
            >
              Explain access
            </Link>
          </div>
        </div>
      ))}
      {total > memberships.length ? (
        <p className="border-t border-line px-4 py-2 text-[12px] text-ink-3">
          Showing the newest {memberships.length} of {total} memberships.
        </p>
      ) : null}
    </OpsCardFlush>
  );
}

/** The full account under diagnosis. */
export function DiagnosticsMembershipDetail({
  membership,
}: {
  membership: MembershipDiagnostic;
}) {
  const facilities = membership.allLocations
    ? "Every facility"
    : membership.facilityNames.length > 0
      ? membership.facilityNames.join(", ")
      : "No facility is assigned to this account";
  return (
    <OpsCardFlush>
      <div className="px-4 py-3">
        <p className="font-mono text-[13px] text-ink">{membership.membershipId}</p>
        <p className="mt-0.5 text-[12px] text-ink-3">
          The membership row of this club, named by its id. It is an account row,
          not a person.
        </p>
      </div>
      <Fact label="Role" value={`${membership.roleName} (${membership.roleKey})`} />
      <Fact
        label="Membership status"
        value={STATUS_LABEL[membership.status] ?? membership.status}
      />
      {membership.status !== "active" ? (
        <div className="border-b border-line px-4 py-3">
          <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">Sign-in</p>
          <p className="mt-1 text-[13px] text-ink-2">
            This membership is {STATUS_LABEL[membership.status] ?? membership.status}, so it
            cannot currently use the club&apos;s sign-in. The destination information below
            is not a statement that this account may act today.
          </p>
        </div>
      ) : null}
      <Fact label="Surface" value={membership.surface ?? "No tenant surface"} />
      <Fact label="Recorded facilities" value={facilities} />
      {membership.facilityBounded ? (
        <div className="border-b border-line px-4 py-3">
          <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">Scope</p>
          <p className="mt-1 text-[13px] text-ink-2">
            This role&apos;s rows are limited to the facilities named above.
          </p>
        </div>
      ) : null}
      <div className="border-b border-line px-4 py-3">
        <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">Grants</p>
        {membership.grants.length === 0 ? (
          <p className="mt-1 text-[13px] text-ink-2">No permissions are granted.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {membership.grants.map((grant) => (
              <li
                key={grant}
                className="rounded-ctl bg-deck px-2 py-0.5 font-mono text-[11px] text-ink-2"
              >
                {grant}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="border-b border-line px-4 py-3">
        <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
          Destination assessment
        </p>
        {membership.destinations.length === 0 ? (
          <p className="mt-1 text-[13px] text-ink-2">
            This role renders no tenant navigation.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {membership.destinations.map((destination) => (
              <li key={destination.href} className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-[12px] text-ink">{destination.href}</span>
                <span className="text-[12px] text-ink-3">{destination.label}</span>
                <StatusBadge
                  tone={destination.reachable === null ? "neutral" : destination.reachable ? "water" : "warn"}
                  className="px-2"
                >
                  {destination.reachable === null ? "Not assessed" : destination.reachable ? "Allowed by role" : "Blocked by role or feature"}
                </StatusBadge>
                {destination.detail ? (
                  <span className="text-[12px] text-ink-2">{destination.detail}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
      {membership.surfaceNavigation.length > 0 ? (
        <div className="px-4 py-3">
          <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
            Navigation this role renders
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {membership.surfaceNavigation.map((item) => (
              <li
                key={item.href}
                className="rounded-ctl bg-deck px-2 py-0.5 font-mono text-[11px] text-ink-2"
              >
                {item.href}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </OpsCardFlush>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-line px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">{label}</p>
      <p className="mt-1 text-[13px] text-ink">{value}</p>
    </div>
  );
}

/** The club's effective entitlements, with their source and expiry. */
export function DiagnosticsEntitlements({
  entitlements,
}: {
  entitlements: FeatureEntitlement[];
}) {
  if (entitlements.length === 0) {
    return (
      <OpsEmptyState
        title="No features are entitled"
        body="This plan grants no feature, and no club override turns one on."
      />
    );
  }
  return (
    <OpsCardFlush>
      {entitlements.map((entitlement) => (
        <div
          key={entitlement.key}
          className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line px-4 py-3 last:border-b-0"
        >
          <span className="font-mono text-[13px] text-ink">{entitlement.key}</span>
          <span className="text-[12px] text-ink-3">
            {SOURCE_LABEL[entitlement.source] ?? entitlement.source}
            {entitlement.expiresAt
              ? ` · expires ${DATETIME_FMT.format(new Date(entitlement.expiresAt))} IST`
              : ""}
          </span>
        </div>
      ))}
    </OpsCardFlush>
  );
}
