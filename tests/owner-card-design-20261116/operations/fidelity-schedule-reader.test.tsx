import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { OwnerScheduleGrid } from "@/components/owner-schedule-grid";

it("does not offer session creation to a read-only program viewer", () => {
  const html = renderToStaticMarkup(<OwnerScheduleGrid view="week" anchor="2026-11-16" days={["2026-11-16"]} locations={[]} sessions={[]} monthCells={null} prevHref="/previous" nextHref="/next" todayHref="/today" canManagePrograms canEditPrograms={false} />);
  expect(html).not.toContain("Add a session (via a batch)");
});
