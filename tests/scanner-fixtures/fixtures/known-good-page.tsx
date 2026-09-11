// D2 — known-good fixture for the page-guard scan.
//
// A page.tsx that DOES call its surface guard. The page-guard
// scan asserts the scanner's regex DOES find `await requireOwner()`
// in this file — proving the regex is not too strict.
//
// Lives under tests/scanner-fixtures/ (outside the production
// scanned tree) so a future regression in the scanner never
// accidentally scans itself.

import { requireOwner } from "@/lib/auth/surface-guard";
import { getOwnerDashboardAction } from "@/lib/actions/dashboard";

export default async function GoodPage() {
  await requireOwner();
  const data = await getOwnerDashboardAction();
  return <main>{data.tenantName}</main>;
}