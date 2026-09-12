// D2 — known-bad fixture for the page-guard scan.
//
// A page.tsx under a tenant route group that does NOT call its
// surface guard. The page-guard scan (tests/page-guard-scan.test.ts)
// asserts the scanner's regex does NOT find the guard call in
// this file — proving the regex correctly flags the bad shape.
//
// Lives under tests/scanner-fixtures/ (outside the production
// scanned tree) so a future regression in the scanner never
// accidentally scans itself.
//
// Mirrors the shape of a real owner page: an export default
// async function with a body that immediately calls a Server
// Action. The missing surface-guard call is the exact bug the
// auditor caught (via Next-Router-State-Tree skipping the layout);
// the scan catches the page-level omission.

import { getOwnerDashboardAction } from "@/lib/actions/dashboard";

export default async function BadPage() {
  const data = await getOwnerDashboardAction();
  return <main>{data.tenantName}</main>;
}