import { expect, it } from "vitest";
import { createElement } from "react";
import Layout0, { metadata as metadata0 } from "@/app/(coach)/coach/announcements/layout";
import Layout1, { metadata as metadata1 } from "@/app/(coach)/coach/curriculum/layout";
import Layout2, { metadata as metadata2 } from "@/app/(coach)/coach/layout";
import Layout3, { metadata as metadata3 } from "@/app/(coach)/coach/me/layout";
import Layout4, { metadata as metadata4 } from "@/app/(coach)/coach/members/layout";
import Layout5, { metadata as metadata5 } from "@/app/(coach)/coach/register/layout";
import Layout6, { metadata as metadata6 } from "@/app/(coach)/coach/schedule/layout";
import Layout7, { metadata as metadata7 } from "@/app/(reception)/reception/announcements/layout";
import Layout8, { metadata as metadata8 } from "@/app/(reception)/reception/bookings/layout";
import Layout9, { metadata as metadata9 } from "@/app/(reception)/reception/cafe/layout";
import Layout10, { metadata as metadata10 } from "@/app/(reception)/reception/close/layout";
import Layout11, { metadata as metadata11 } from "@/app/(reception)/reception/collect-payment/layout";
import Layout12, { metadata as metadata12 } from "@/app/(reception)/reception/dues/layout";
import Layout13, { metadata as metadata13 } from "@/app/(reception)/reception/enquiries/layout";
import Layout14, { metadata as metadata14 } from "@/app/(reception)/reception/layout";
import Layout15, { metadata as metadata15 } from "@/app/(reception)/reception/me/layout";
import Layout16, { metadata as metadata16 } from "@/app/(reception)/reception/members/layout";
import Layout17, { metadata as metadata17 } from "@/app/(self)/family/activate/layout";
import Layout18, { metadata as metadata18 } from "@/app/(self)/family/announcements/layout";
import Layout19, { metadata as metadata19 } from "@/app/(self)/family/billing/layout";
import Layout20, { metadata as metadata20 } from "@/app/(self)/family/layout";
import Layout21, { metadata as metadata21 } from "@/app/(self)/family/showcase/layout";
import Layout22, { metadata as metadata22 } from "@/app/(self)/family/sign-in/layout";
import Layout23, { metadata as metadata23 } from "@/app/(self)/member/activate/layout";
import Layout24, { metadata as metadata24 } from "@/app/(self)/member/announcements/layout";
import Layout25, { metadata as metadata25 } from "@/app/(self)/member/billing/layout";
import Layout26, { metadata as metadata26 } from "@/app/(self)/member/layout";
import Layout27, { metadata as metadata27 } from "@/app/(self)/member/showcase/layout";
import Layout28, { metadata as metadata28 } from "@/app/(self)/member/sign-in/layout";
import Layout29, { metadata as metadata29 } from "@/app/(worker)/worker/announcements/layout";
import Layout30, { metadata as metadata30 } from "@/app/(worker)/worker/layout";

const cases = [
  ["app/(coach)/coach/announcements/layout.tsx", metadata0, Layout0, "Announcements · Aqua"],
  ["app/(coach)/coach/curriculum/layout.tsx", metadata1, Layout1, "Curriculum · Aqua"],
  ["app/(coach)/coach/layout.tsx", metadata2, Layout2, "Today · Aqua"],
  ["app/(coach)/coach/me/layout.tsx", metadata3, Layout3, "Account · Aqua"],
  ["app/(coach)/coach/members/layout.tsx", metadata4, Layout4, "Members · Aqua"],
  ["app/(coach)/coach/register/layout.tsx", metadata5, Layout5, "Attendance · Aqua"],
  ["app/(coach)/coach/schedule/layout.tsx", metadata6, Layout6, "Schedule · Aqua"],
  ["app/(reception)/reception/announcements/layout.tsx", metadata7, Layout7, "Announcements · Aqua"],
  ["app/(reception)/reception/bookings/layout.tsx", metadata8, Layout8, "Bookings · Aqua"],
  ["app/(reception)/reception/cafe/layout.tsx", metadata9, Layout9, "Café · Aqua"],
  ["app/(reception)/reception/close/layout.tsx", metadata10, Layout10, "Close day · Aqua"],
  ["app/(reception)/reception/collect-payment/layout.tsx", metadata11, Layout11, "Collect payment · Aqua"],
  ["app/(reception)/reception/dues/layout.tsx", metadata12, Layout12, "Dues · Aqua"],
  ["app/(reception)/reception/enquiries/layout.tsx", metadata13, Layout13, "Enquiries · Aqua"],
  ["app/(reception)/reception/layout.tsx", metadata14, Layout14, "Today · Aqua"],
  ["app/(reception)/reception/me/layout.tsx", metadata15, Layout15, "Account · Aqua"],
  ["app/(reception)/reception/members/layout.tsx", metadata16, Layout16, "Members · Aqua"],
  ["app/(self)/family/activate/layout.tsx", metadata17, Layout17, "Activation · Aqua"],
  ["app/(self)/family/announcements/layout.tsx", metadata18, Layout18, "Announcements · Aqua"],
  ["app/(self)/family/billing/layout.tsx", metadata19, Layout19, "Fees and payments · Aqua"],
  ["app/(self)/family/layout.tsx", metadata20, Layout20, "Family view · Aqua"],
  ["app/(self)/family/showcase/layout.tsx", metadata21, Layout21, "Achievements · Aqua"],
  ["app/(self)/family/sign-in/layout.tsx", metadata22, Layout22, "Sign in · Aqua"],
  ["app/(self)/member/activate/layout.tsx", metadata23, Layout23, "Activation · Aqua"],
  ["app/(self)/member/announcements/layout.tsx", metadata24, Layout24, "Announcements · Aqua"],
  ["app/(self)/member/billing/layout.tsx", metadata25, Layout25, "Fees and payments · Aqua"],
  ["app/(self)/member/layout.tsx", metadata26, Layout26, "Member view · Aqua"],
  ["app/(self)/member/showcase/layout.tsx", metadata27, Layout27, "Achievements · Aqua"],
  ["app/(self)/member/sign-in/layout.tsx", metadata28, Layout28, "Sign in · Aqua"],
  ["app/(worker)/worker/announcements/layout.tsx", metadata29, Layout29, "Announcements · Aqua"],
  ["app/(worker)/worker/layout.tsx", metadata30, Layout30, "My workday · Aqua"],
] as const;

it.each(cases)("provides fixed task metadata and passes children through: %s", (_path, metadata, Layout, expected) => {
  expect(metadata.title).toEqual({ absolute: expected });
  const child = createElement("span", null, "private person and club");
  expect(Layout({ children: child })).toBe(child);
  expect(expected).not.toMatch(/private|person|club|[0-9a-f]{8}-[0-9a-f-]{27}/i);
});
