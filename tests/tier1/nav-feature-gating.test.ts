// @vitest-environment jsdom
import { afterAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { asTenantId, type TenantId } from "@/lib/ids";
import { seedRoleTemplates } from "@/lib/services/roles";
import OwnerLayout from "@/app/(owner)/layout";
import ReportsPage from "@/app/(owner)/owner/reports/page";
import { BottomNav } from "@/components/bottom-nav";

// PR B — feature entitlements on nav and pages.
//
// The audit found: a tenant with the `reports` feature OFF could
// still see the Reports nav tile, navigate to /owner/reports, and
// trigger a ForbiddenError from the action layer's
// requirePermission(ctx, "reports.operational"). The fix is the
// shape architecture §7.3 calls for everywhere a gated feature
// meets the user:
//   1. Nav item: BottomNav filters on item.featureKey — the layout
//      passes the features the tenant does NOT have.
//   2. Page: /owner/reports renders notFound() when the feature is
//      off — same 404 as a made-up URL.
//
// Three things this file proves:
//   - BottomNav hides a featureKey'd item when its key is in
//     hiddenFeatures, shows it otherwise.
//   - OwnerLayout's nav contains no Reports item when the tenant
//     has reports OFF.
//   - /owner/reports renders notFound() when reports is OFF and
//     renders report data when reports is ON.
//
// The two DB tests use the real schema (auth/headers are mocked
// to point at a freshly minted user per case, exactly like
// tests/tier1/batch-detail-page.test.ts).

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const authUser = vi.hoisted(() => ({ betterAuthId: "" }));
vi.mock("@/lib/auth/server", () => ({
  auth: {
    api: {
      getSession: async () => ({
        user: { id: authUser.betterAuthId },
        session: { createdAt: new Date() },
      }),
    },
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

// notFound() throws NEXT_NOT_FOUND in production; the mock turns
// it into a sentinel the test can catch. redirect is unexpected
// in these tests — any redirect means the page or layout failed
// to resolve a session for the fabricated user.
class NotFoundSignal extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
  }
}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundSignal();
  },
  redirect: (path: string) => {
    throw new Error(`unexpected redirect: ${path}`);
  },
  usePathname: () => "/owner",
}));

const RUN = Date.now().toString(36);

const tenants: { tenantId: TenantId; ownerUserId: string }[] = [];

afterAll(async () => {
  for (const { tenantId, ownerUserId } of tenants) {
    await admin.query("delete from attendance where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from sessions where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from enrolments where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from batches where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from programs where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from members where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from persons where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from tenant_memberships where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from roles where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from tenant_features where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from locations where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from users where id = $1::uuid", [ownerUserId]);
    await admin.query("delete from tenants where id = $1::uuid", [tenantId]);
  }
  await admin.end();
});

async function setupTenant(opts: {
  reportsOn: boolean;
  label: string;
}): Promise<{ tenantId: TenantId }> {
  const tenantId = asTenantId(uuidv7());
  const ownerUserId = uuidv7();
  const betterAuthId = `prB-${opts.label}-${RUN}-${uuidv7().slice(0, 8)}`;
  const slug = `prB-${opts.label}-${RUN}-${uuidv7().slice(0, 8)}`;

  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, $3, 'active', 'Asia/Kolkata')",
    [tenantId, slug, `PR B ${opts.label}`],
  );
  await seedRoleTemplates(tenantId);

  // Enable every always-on GA feature for this tenant, plus
  // `reports` only when the test opts in.
  const alwaysOn = ["members", "attendance", "programs", "enquiries", "staff", "settings"];
  for (const f of alwaysOn) {
    await admin.query(
      "insert into tenant_features (tenant_id, feature_key, enabled) values ($1, $2, true)",
      [tenantId, f],
    );
  }
  if (opts.reportsOn) {
    await admin.query(
      "insert into tenant_features (tenant_id, feature_key, enabled) values ($1, 'reports', true)",
      [tenantId],
    );
  }

  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Main', true)",
    [uuidv7(), tenantId],
  );

  const ownerRole = (
    await admin.query<{ id: string }>(
      "select id from roles where tenant_id = $1 and key = 'owner'",
      [tenantId],
    )
  ).rows[0]!.id;

  await admin.query(
    "insert into users (id, phone, better_auth_id) values ($1, $2, $3)",
    [ownerUserId, `+91prb-${RUN}-${ownerUserId.slice(0, 12)}`, betterAuthId],
  );
  await admin.query(
    "insert into tenant_memberships (id, tenant_id, user_id, role_id, all_locations, status) values ($1, $2, $3, $4, true, 'active')",
    [uuidv7(), tenantId, ownerUserId, ownerRole],
  );

  tenants.push({ tenantId, ownerUserId });
  authUser.betterAuthId = betterAuthId;

  return { tenantId };
}

function flattenStrings(node: unknown): string[] {
  const out: string[] = [];
  walk(node);
  return out;
  function walk(n: unknown) {
    if (n == null || typeof n === "boolean") return;
    if (typeof n === "string" || typeof n === "number") {
      out.push(String(n));
      return;
    }
    if (Array.isArray(n)) {
      for (const c of n) walk(c);
      return;
    }
    if (typeof n === "object" && "props" in (n as Record<string, unknown>)) {
      const props = (n as { props: Record<string, unknown> }).props;
      // Walk props.children (the standard React child channel).
      walk(props.children);
      // Walk any string-valued props — lucide icons render their
      // accessible name into `aria-label` / `aria-hidden`, but for
      // nav items the only thing that survives renderToString is
      // the `label` text we pass in. Walk every prop's children
      // recursively so we don't miss a `label` slipped into an
      // attribute somewhere; for nav items, walking children is
      // sufficient because the label is the only text.
    }
  }
}

// Walk a React element tree and return the prop values for any
// BottomNav instance found inside it. The layout calls BottomNav
// once at the bottom of its output, so this returns one entry or
// nothing.
function findBottomNavProps(node: unknown): { items: Array<{ label: string; href?: string; featureKey?: string }>; hiddenFeatures?: string[] } | null {
  if (node == null) return null;
  if (typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const c of node) {
      const found = findBottomNavProps(c);
      if (found) return found;
    }
    return null;
  }
  const obj = node as Record<string, unknown>;
  if ("props" in obj) {
    const props = obj.props as Record<string, unknown>;
    if (typeof props === "object" && props !== null && "items" in props && Array.isArray(props.items)) {
      return props as { items: Array<{ label: string; href?: string; featureKey?: string }>; hiddenFeatures?: string[] };
    }
    return findBottomNavProps(props.children);
  }
  return null;
}

describe("BottomNav (feature-key unit, no DB)", () => {
  it("hides a featureKey'd item when its key is in hiddenFeatures", () => {
    const tree = BottomNav({
      items: [
        { href: "/owner", label: "Home", iconName: "layout-dashboard" },
        { href: "/owner/reports", label: "Reports", iconName: "file-text", featureKey: "reports" },
      ],
      hiddenFeatures: ["reports"],
    });
    const labels = flattenStrings(tree);
    expect(labels).toContain("Home");
    expect(labels).not.toContain("Reports");
  });

  it("shows a featureKey'd item when its key is NOT in hiddenFeatures", () => {
    const tree = BottomNav({
      items: [
        { href: "/owner", label: "Home", iconName: "layout-dashboard" },
        { href: "/owner/reports", label: "Reports", iconName: "file-text", featureKey: "reports" },
      ],
      hiddenFeatures: [],
    });
    const labels = flattenStrings(tree);
    expect(labels).toContain("Home");
    expect(labels).toContain("Reports");
  });

  it("leaves items without a featureKey untouched regardless of hiddenFeatures", () => {
    const tree = BottomNav({
      items: [
        { href: "/owner", label: "Home", iconName: "layout-dashboard" },
        { href: "/owner/members", label: "Members", iconName: "users" },
      ],
      hiddenFeatures: ["reports", "billing"],
    });
    const labels = flattenStrings(tree);
    expect(labels).toContain("Home");
    expect(labels).toContain("Members");
  });
});

describe("OwnerLayout + ReportsPage (real DB, with/without reports feature)", () => {
  it("passes no hidden features when reports is ON (Reports item reaches BottomNav unfiltered)", async () => {
    await setupTenant({ reportsOn: true, label: "on" });
    const tree = await OwnerLayout({ children: null });
    const nav = findBottomNavProps(tree);
    expect(nav).not.toBeNull();
    expect(nav!.hiddenFeatures ?? []).toEqual([]);
    // The Reports item itself is in the items array with its
    // featureKey — BottomNav will render it because the layout
    // hasn't filtered it out.
    const reportsItem = nav!.items.find((i) => i.featureKey === "reports");
    expect(reportsItem?.label).toBe("Reports");
  });

  it("passes 'reports' as a hidden feature when reports is OFF (BottomNav filters the tile out)", async () => {
    await setupTenant({ reportsOn: false, label: "off" });
    const tree = await OwnerLayout({ children: null });
    const nav = findBottomNavProps(tree);
    expect(nav).not.toBeNull();
    expect(nav!.hiddenFeatures ?? []).toContain("reports");
    // And driving BottomNav with that hidden list actually drops
    // the tile — the BottomNav unit test covers the filter
    // mechanic; this test proves the layout's hiddenFeatures
    // matches what the feature off state implies.
    const rendered = BottomNav({
      // BottomNav's prop type requires iconName; the layout passes
      // it for every real item, so this cast is safe — the
      // findBottomNavProps helper above only reads label/href/
      // featureKey because that's what the assertions care about.
      items: nav!.items as Parameters<typeof BottomNav>[0]["items"],
      hiddenFeatures: nav!.hiddenFeatures ?? [],
    });
    const labels = flattenStrings(rendered);
    expect(labels).toContain("Home");
    expect(labels).not.toContain("Reports");
  });

  it("renders the reports page when the tenant has reports ON", async () => {
    const { tenantId } = await setupTenant({ reportsOn: true, label: "pageOn" });
    const programId = uuidv7();
    await admin.query(
      "insert into programs (id, tenant_id, name) values ($1, $2, 'P')",
      [programId, tenantId],
    );
    await admin.query(
      `insert into batches (id, tenant_id, program_id, name, capacity, days_of_week, start_time, end_time)
       values ($1, $2, $3, 'B', 10, '{1,3,5}', '07:00', '08:00')`,
      [uuidv7(), tenantId, programId],
    );

    const result = await ReportsPage({ searchParams: Promise.resolve({}) });
    const rendered = flattenStrings(result).join(" ");
    expect(rendered).toContain("Reports");
  });

  it("calls notFound() when the tenant has reports OFF", async () => {
    await setupTenant({ reportsOn: false, label: "pageOff" });
    await expect(
      ReportsPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow(NotFoundSignal);
  });
});