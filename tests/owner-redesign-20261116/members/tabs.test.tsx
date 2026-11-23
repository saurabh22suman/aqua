import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemberDetailTabs } from "@/components/member-detail/member-detail-tabs";

it("keeps primary tabs and only available scoped destinations in the approved More menu", () => {
  const html = renderToStaticMarkup(<MemberDetailTabs memberId="m" active="overview" facilityScope="north" />);
  const nav = html.match(/<nav[\s\S]*?<\/nav>/)?.[0] ?? "";
  const more = nav.match(/<details[\s\S]*?<\/details>/)?.[0] ?? "";
  for (const tab of ["overview", "payments", "progress"]) {
    expect(nav).toContain(`tab=${tab}&amp;facility=north`);
    expect(more).not.toContain(`tab=${tab}`);
  }
  expect(more).toContain("More");
  expect(more).toContain("tab=notes&amp;facility=north");
  expect(more).not.toContain("tab=documents");
});
