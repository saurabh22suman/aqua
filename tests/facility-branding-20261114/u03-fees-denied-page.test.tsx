import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ overview: vi.fn(), invoices: vi.fn(), transactions: vi.fn(), plans: vi.fn(), cookie: undefined as string | undefined }));
vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner: async () => ({ permissions: new Set(["reports.financial"]) }), requirePagePermission: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: state.cookie }) }) }));
vi.mock("@/lib/services/selected-facility-access", () => ({ canSelectFacility: async () => false }));
vi.mock("@/lib/actions/fees-hub", () => ({ getFeesOverviewAction: state.overview, listHubInvoicesAction: state.invoices, listHubTransactionsAction: state.transactions }));
vi.mock("@/lib/actions/membership-plans", () => ({ listPlansAction: state.plans }));
vi.mock("@/components/owner-ui/owner-link", () => ({ OwnerLink: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
import FeesPage from "@/app/(owner)/owner/fees/page";

it.each(["url", "cookie"])("denies an unavailable %s facility before financial reads and offers explicit recovery", async (source) => {
  const id = "83bcb5a8-63dc-4e06-b7b0-ff18becc1b13";
  state.cookie = source === "cookie" ? id : undefined;
  const html = renderToStaticMarkup(await FeesPage({ searchParams: Promise.resolve({ tab: "dues", from: "2026-01-01", to: "2026-01-31", ...(source === "url" ? { facility: id } : {}) }) }));
  expect(html).toContain("Facility unavailable");
  expect(html).toContain("facility=all");
  expect(html).toContain("tab=dues");
  expect(html).not.toContain("Nothing outstanding");
  expect(state.overview).not.toHaveBeenCalled();
  expect(state.invoices).not.toHaveBeenCalled();
  expect(state.transactions).not.toHaveBeenCalled();
  expect(state.plans).not.toHaveBeenCalled();
});
