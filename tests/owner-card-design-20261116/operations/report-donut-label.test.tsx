import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Donut } from "@/components/charts/report-donut";

it("uses an optional display label without changing the default numeric title", () => {
  const html = renderToStaticMarkup(<Donut ariaLabel="Breakdown" slices={[
    { label: "Cash", value: 45600, valueLabel: "₹456.00", tone: "stroke-water" },
    { label: "Members", value: 3, tone: "stroke-water" },
  ]} />);
  expect(html).toContain("Cash: ₹456.00");
  expect(html).toContain("Members: 3");
  expect(html).not.toContain("Cash: 45600");
});
