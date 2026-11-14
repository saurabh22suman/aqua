import { expect, it } from "vitest";
import { createElement } from "react";
import Layout0, { metadata as metadata0 } from "@/app/(owner)/owner/announcements/layout";
import Layout1, { metadata as metadata1 } from "@/app/(owner)/owner/batches/layout";
import Layout2, { metadata as metadata2 } from "@/app/(owner)/owner/bookings/layout";
import Layout3, { metadata as metadata3 } from "@/app/(owner)/owner/enquiries/layout";
import Layout4, { metadata as metadata4 } from "@/app/(owner)/owner/fees/layout";
import Layout5, { metadata as metadata5 } from "@/app/(owner)/owner/inbox/layout";
import Layout6, { metadata as metadata6 } from "@/app/(owner)/owner/invoices/layout";
import Layout7, { metadata as metadata7 } from "@/app/(owner)/owner/layout";
import Layout8, { metadata as metadata8 } from "@/app/(owner)/owner/members/layout";
import Layout9, { metadata as metadata9 } from "@/app/(owner)/owner/onboarding/layout";
import Layout10, { metadata as metadata10 } from "@/app/(owner)/owner/programs/layout";
import Layout11, { metadata as metadata11 } from "@/app/(owner)/owner/reports/layout";
import Layout12, { metadata as metadata12 } from "@/app/(owner)/owner/schedule/layout";
import Layout13, { metadata as metadata13 } from "@/app/(owner)/owner/sessions/layout";
import Layout14, { metadata as metadata14 } from "@/app/(owner)/owner/settings/layout";
import Layout15, { metadata as metadata15 } from "@/app/(owner)/owner/staff/layout";

const cases = [
  ["app/(owner)/owner/announcements/layout.tsx", metadata0, Layout0, "Announcements · Aqua"],
  ["app/(owner)/owner/batches/layout.tsx", metadata1, Layout1, "Batches · Aqua"],
  ["app/(owner)/owner/bookings/layout.tsx", metadata2, Layout2, "Bookings · Aqua"],
  ["app/(owner)/owner/enquiries/layout.tsx", metadata3, Layout3, "Enquiries · Aqua"],
  ["app/(owner)/owner/fees/layout.tsx", metadata4, Layout4, "Fees & payments · Aqua"],
  ["app/(owner)/owner/inbox/layout.tsx", metadata5, Layout5, "Notifications · Aqua"],
  ["app/(owner)/owner/invoices/layout.tsx", metadata6, Layout6, "Invoices · Aqua"],
  ["app/(owner)/owner/layout.tsx", metadata7, Layout7, "Home · Aqua"],
  ["app/(owner)/owner/members/layout.tsx", metadata8, Layout8, "Members · Aqua"],
  ["app/(owner)/owner/onboarding/layout.tsx", metadata9, Layout9, "Getting started · Aqua"],
  ["app/(owner)/owner/programs/layout.tsx", metadata10, Layout10, "Programs · Aqua"],
  ["app/(owner)/owner/reports/layout.tsx", metadata11, Layout11, "Reports · Aqua"],
  ["app/(owner)/owner/schedule/layout.tsx", metadata12, Layout12, "Schedule · Aqua"],
  ["app/(owner)/owner/sessions/layout.tsx", metadata13, Layout13, "Sessions · Aqua"],
  ["app/(owner)/owner/settings/layout.tsx", metadata14, Layout14, "Settings · Aqua"],
  ["app/(owner)/owner/staff/layout.tsx", metadata15, Layout15, "Staff · Aqua"],
] as const;

it.each(cases)("provides fixed task metadata and passes children through: %s", (_path, metadata, Layout, expected) => {
  expect(metadata.title).toEqual({ absolute: expected });
  const child = createElement("span", null, "private person and club");
  expect(Layout({ children: child })).toBe(child);
  expect(expected).not.toMatch(/private|person|club|[0-9a-f]{8}-[0-9a-f-]{27}/i);
});
