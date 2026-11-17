// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { HubInvoiceRow } from "@/lib/services/fees-hub";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/fees-hub", () => ({ listHubInvoicesAction: async () => [] }));
vi.mock("@/components/member-detail/invoice-expanded", () => ({ InvoiceExpanded: () => null }));
import { FeesInvoiceList } from "@/components/fees/fees-invoice-list";

const invoice: HubInvoiceRow = { id:"invoice",invoiceNumber:"LOCAL/26/OPEN",memberId:"member",memberName:"Local Test Member",payerKind:"member",payerName:"Local Test Member",totalPaise:32100,paidPaise:0,outstandingPaise:32100,status:"issued",source:"membership",issuedOn:"2026-11-01",dueOn:"2026-11-05",locationName:"Local facility" };
afterEach(cleanup);
it.each([undefined,"11111111-1111-4111-8111-111111111111"])("carries invoice-list scope %s into the member record", (facility) => {
  render(<FeesInvoiceList initial={[invoice]} filter="dues" facility={facility} canWrite={false} canRecord={false} canRefund={false} canReadPayments={false} />);
  expect(screen.getByRole("link",{name:"Local Test Member"}).getAttribute("href")).toBe(`/owner/members/member?facility=${facility ?? "all"}`);
});
