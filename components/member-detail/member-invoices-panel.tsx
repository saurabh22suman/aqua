"use client";

import dynamic from "next/dynamic";

// The invoice panel is already selected by the Payments tab or payer view.
// Preserve server rendering while separating its client graph from Overview.
export const MemberInvoicesPanel = dynamic(
  () => import("./member-invoices-content").then((module) => module.MemberInvoicesPanel),
);
