import { FEATURES } from "@/db/seed-platform";
import {
  ForbiddenError,
  moduleForPermission,
  requirePermission,
} from "@/lib/auth/permission";
import {
  SURFACE_OWNER,
  surfaceForRole,
  type TenantSurface,
} from "@/lib/auth/surface-access";
import {
  ownerNavPermissionGate,
  OWNER_SIDEBAR_GROUPS,
  TENANT_SURFACE_NAV,
  filterOwnerNavItems,
  navForRole,
} from "@/lib/nav";
import type { NavItem } from "@/components/bottom-nav";
import type { Ctx } from "@/lib/auth/context";

export type DestinationReason =
  | "not_assessed"
  | "permission"
  | "feature"
  | "unknown_permission"
  | null;

export type DestinationEligibility = {
  href: string;
  label: string;
  reachable: boolean | null;
  reason: DestinationReason;
  detail: string | null;
};

export type AccountEligibility = {
  /** The surface the role works in, or null when it has none. */
  surface: TenantSurface | null;
  /** The navigation that surface renders for these grants. */
  surfaceNavigation: { href: string; label: string }[];
  /** Owner navigation gate outcomes, or unassessed non-owner navigation. */
  destinations: DestinationEligibility[];
};

/** The feature catalogue is the human-readable name of a moduleKey. */
const FEATURE_NAME = new Map(FEATURES.map((f) => [f.key, f.name]));

/** The owner surface's real destinations — the shared gate map's scope. */
function ownerSurfaceDestinations(): NavItem[] {
  return OWNER_SIDEBAR_GROUPS.flatMap((group) => group.items);
}

function surfaceDestinations(surface: TenantSurface | null): NavItem[] {
  if (surface === null) return [];
  if (surface === SURFACE_OWNER) return ownerSurfaceDestinations();
  return TENANT_SURFACE_NAV[surface];
}

function eligibilityFor(
  item: NavItem,
  surface: TenantSurface | null,
  context: Pick<Ctx, "permissions" | "features">,
): DestinationEligibility {
  const base = { href: item.href, label: item.label };
  if (surface !== SURFACE_OWNER) {
    return {
      ...base,
      reachable: null,
      reason: "not_assessed",
      detail: "This surface has no central per-route gate assessment here. Navigation alone does not establish access.",
    };
  }
  const gate = ownerNavPermissionGate(item.href);
  if (!gate) {
    return { ...base, reachable: true, reason: null, detail: null };
  }
  // REVIEW D5 — the catalogue is consulted before the resolution, so an
  // unknown gate is reported as a product defect and never as a missing
  // grant.
  const moduleKey = moduleForPermission(gate);
  if (moduleKey === undefined) {
    return {
      ...base,
      reachable: false,
      reason: "unknown_permission",
      detail:
        `This destination's gate (${gate}) is not a permission the platform knows. ` +
        "That is a product defect, not a missing grant.",
    };
  }
  try {
    requirePermission(context, gate);
    return { ...base, reachable: true, reason: null, detail: null };
  } catch (error) {
    if (!(error instanceof ForbiddenError)) throw error;
    if (error.reason === "role_grant_missing") {
      return {
        ...base,
        reachable: false,
        reason: "permission",
        detail: `This role does not hold ${gate}.`,
      };
    }
    const featureName = FEATURE_NAME.get(moduleKey) ?? moduleKey;
    return {
      ...base,
      reachable: false,
      reason: "feature",
      detail: `The ${featureName} feature is not enabled for this club.`,
    };
  }
}

/**
 * Owner navigation gate outcomes and other surfaces' unassessed navigation.
 *
 * `permissions` and `features` are the sets the product's own
 * `resolvePermissionContext` produces for the role in the club — the
 * caller never invents them.
 */
export function accountEligibility(
  roleKey: string,
  permissions: Set<string>,
  features: Set<string>,
): AccountEligibility {
  const surface = surfaceForRole(roleKey);
  // The two sets the resolution reads. Typed as the resolution's own
  // parameter type, so no cast can hide a partial context.
  const context: Pick<Ctx, "permissions" | "features"> = {
    permissions,
    features,
  };
  return {
    surface,
    surfaceNavigation: filterOwnerNavItems(navForRole(roleKey), permissions).map(
      (item) => ({ href: item.href, label: item.label }),
    ),
    destinations: surfaceDestinations(surface).map((item) =>
      eligibilityFor(item, surface, context),
    ),
  };
}
