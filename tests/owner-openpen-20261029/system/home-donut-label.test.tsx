// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

// The phone payment-mix ring must never paint its total over the band.
//
// The Home payment mix draws a server-rendered SVG ring below `lg`. The
// captured total sat in the ring's centre as SVG text, and at 390 the
// text "₹2,66,355" was wider than the hole: it painted across the
// coloured band in both themes (the reviewer's own capture, at
// mobile-390x844).
//
// What this pins:
//
//   * a total that fits the hole stays in the centre — the approved
//     composition is untouched;
//   * a total that does not fit is rendered in FULL next to the ring,
//     never truncated, never rounded and never shrunk into the band;
//   * every fixture is a real mix: the total is the sum of the slices,
//     so the ring's arithmetic is never fiction;
//   * the ring keeps its categories, its colours and its own caption.
//
// The rendered containment (the label's text box against the actual
// inner circle) is measured in Chrome by the durable probe
// (home-donut-hole-containment.ts); this suite pins the policy and the
// structure behind it.

import { MiniDonut } from "@/components/owner-mini-donut";

afterEach(cleanup);

/** A real mix: the slices always add up to the total. */
function mix(slices: Array<{ key: string; label: string; paise: number }>) {
  const totalPaise = slices.reduce((sum, slice) => sum + slice.paise, 0);
  return { slices, totalPaise };
}

const SMALL = mix([
  { key: "cash", label: "Cash", paise: 200000 },
  { key: "digital", label: "Digital", paise: 300000 },
]);

const SIX_CHARACTERS = mix([
  { key: "cash", label: "Cash", paise: 499900 },
  { key: "digital", label: "Digital", paise: 500000 },
]);

const SEVEN_CHARACTERS = mix([
  { key: "cash", label: "Cash", paise: 2000000 },
  { key: "digital", label: "Digital", paise: 3000000 },
]);

const FRACTIONAL = mix([
  { key: "cash", label: "Cash", paise: 1000000 },
  { key: "digital", label: "Digital", paise: 234550 },
]);

const CAPTURED = mix([
  { key: "cash", label: "Cash", paise: 6913500 },
  { key: "digital", label: "Digital", paise: 13830000 },
  { key: "other", label: "Other", paise: 5892000 },
]);

const ARIA = "Payment mix for this month: cash, digital and other, in rupees.";

function renderRing(fixture: ReturnType<typeof mix>) {
  return render(
    <MiniDonut
      slices={fixture.slices}
      totalPaise={fixture.totalPaise}
      ariaLabel={ARIA}
    />,
  );
}

describe("the phone payment-mix ring", () => {
  it("keeps a total that fits the hole in the centre", () => {
    const { container } = renderRing(SMALL);

    expect(container.querySelector("svg")?.textContent).toContain("₹5,000");
  });

  it("keeps a six-character total in the centre", () => {
    const { container } = renderRing(SIX_CHARACTERS);

    expect(container.querySelector("svg")?.textContent).toContain("₹9,999");
  });

  it("moves a seven-character total next to the ring", () => {
    const { container } = renderRing(SEVEN_CHARACTERS);

    // The exact amount is still there, in full …
    expect(container.textContent).toContain("₹50,000");
    // … but not as the ring's centre label, which is what painted over
    // the band.
    expect(container.querySelector("svg")?.textContent).not.toContain("₹50,000");
  });

  it("renders a fractional total in full, next to the ring", () => {
    const { container } = renderRing(FRACTIONAL);

    expect(container.textContent).toContain("₹12,345.50");
    expect(container.querySelector("svg")?.textContent).not.toContain(
      "₹12,345.50",
    );
  });

  it("renders a total the hole cannot hold in full, next to the ring", () => {
    const { container } = renderRing(CAPTURED);

    expect(container.textContent).toContain("₹2,66,355");
    expect(container.querySelector("svg")?.textContent).not.toContain(
      "₹2,66,355",
    );
  });

  it("keeps the ring's categories, colours and arithmetic", () => {
    const { container } = renderRing(CAPTURED);

    const svg = container.querySelector("svg");
    const segments = Array.from(
      svg?.querySelectorAll("circle") ?? [],
    ).filter((circle) => circle.getAttribute("stroke-dasharray"));
    expect(segments).toHaveLength(3);
    expect(segments.map((circle) => circle.getAttribute("stroke"))).toEqual([
      "var(--chart-1)",
      "var(--chart-2)",
      "var(--chart-3)",
    ]);

    // The segments add up to one whole ring: the total is the mix.
    const circumference = 2 * Math.PI * 42;
    const drawn = segments.reduce((sum, circle) => {
      const [length] = (circle.getAttribute("stroke-dasharray") ?? "0")
        .split(" ")
        .map(Number);
      return sum + (length ?? 0);
    }, 0);
    expect(drawn).toBeCloseTo(circumference, 5);
    // … and the total is the sum of the slices.
    expect(CAPTURED.totalPaise).toBe(
      CAPTURED.slices.reduce((sum, slice) => sum + slice.paise, 0),
    );
  });

  it("keeps the ring's own description and caption", () => {
    const { container } = renderRing(CAPTURED);

    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toContain("cash, digital and other");
    // The ring keeps its "collected" caption when the amount moves out.
    expect(svg?.textContent).toContain("collected");
  });
});
