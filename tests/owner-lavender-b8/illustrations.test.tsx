// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

// Owner Lavender B — the small sport artwork beside the Owner header.
//
// The human approved a small sport illustration next to the daily Owner
// header. It has to be:
//
//   * ORIGINAL art, drawn as SVG in the app (never a raster of the
//     approved board dropped into a page);
//   * SMALL — it sits beside a heading, it does not become the screen;
//   * COORDINATED — the swimmer, the badminton player and the
//     footballer share one visual language and one set of semantic
//     illustration tokens, so they follow the theme;
//   * HONEST — it is chosen from the club's own programme names. When
//     the data model cannot say which sports the club runs, the art
//     falls back to a neutral club mark instead of guessing;
//   * STABLE — the choice is derived from a seed, so a re-render, a
//     hydration pass or a route change never swaps the artwork under
//     the reader;
//   * STATIC FIRST — no idle loop, and a reduced-motion reader sees a
//     still picture.
//
// RED status at the time of writing: components/illustrations/** did
// not exist, so the module resolution failed. The stubs below are the
// "the file exists but does not do the work yet" starting point; the
// assertions are the behaviour that had to be implemented.

afterEach(cleanup);

async function loadModules() {
  const [sport, art] = await Promise.all([
    import("@/components/illustrations/resolve-sport"),
    import("@/components/illustrations/sport-illustration"),
  ]);
  return { ...sport, ...art };
}

describe("the artwork is chosen from the club's own programmes", () => {
  it("reads a swimming programme as swimming", async () => {
    const { resolveSportKey } = await loadModules();
    expect(resolveSportKey({ programNames: ["Swimming Foundations"] })).toBe("swimming");
  });

  it("reads a badminton programme as badminton", async () => {
    const { resolveSportKey } = await loadModules();
    expect(resolveSportKey({ programNames: ["Junior Badminton"] })).toBe("badminton");
  });

  it("reads a football programme as football", async () => {
    const { resolveSportKey } = await loadModules();
    expect(resolveSportKey({ programNames: ["Football Academy"] })).toBe("football");
  });

  it("falls back to the neutral club mark when no programme names a sport", async () => {
    const { resolveSportKey } = await loadModules();
    expect(resolveSportKey({ programNames: ["Art & Craft", "Yoga"] })).toBe("club");
    expect(resolveSportKey({ programNames: [] })).toBe("club");
  });

  it("lets a specific context win over the programme names", async () => {
    const { resolveSportKey } = await loadModules();
    expect(
      resolveSportKey({ programNames: ["Swimming Foundations"], context: "badminton" }),
    ).toBe("badminton");
  });

  it("picks the same artwork for the same seed and never re-randomises", async () => {
    const { resolveSportKey } = await loadModules();
    const names = ["Swimming Foundations", "Football Academy"];
    const first = resolveSportKey({ programNames: names, seed: "club-42" });
    const second = resolveSportKey({ programNames: names, seed: "club-42" });
    expect(first).toBe(second);
    // And it is one of the sports the club actually named — never a
    // sport the club does not run.
    expect(["swimming", "football"]).toContain(first);
  });
});

describe("the artwork itself", () => {
  it("draws an accessible SVG that names the sport", async () => {
    const { SportIllustration } = await loadModules();
    const { container } = render(<SportIllustration sport="swimming" />);
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")?.toLowerCase()).toContain("swim");
    expect(svg?.getAttribute("data-variant")).toBe("swimming");
  });

  it("draws a different picture for each supported sport", async () => {
    const { SportIllustration } = await loadModules();
    const variants = (["swimming", "badminton", "football", "club"] as const).map((sport) => {
      const { container } = render(<SportIllustration sport={sport} />);
      return container.querySelector("svg")?.innerHTML;
    });
    expect(new Set(variants).size).toBe(4);
  });

  it("renders identical markup on a re-render, so nothing is randomised", async () => {
    const { SportIllustration } = await loadModules();
    const { container, rerender } = render(<SportIllustration sport="football" />);
    const first = container.querySelector("svg")?.innerHTML;
    rerender(<SportIllustration sport="football" />);
    const second = container.querySelector("svg")?.innerHTML;
    expect(second).toBe(first);
  });

  it("uses no SMIL animation, which would ignore prefers-reduced-motion", async () => {
    const { SportIllustration } = await loadModules();
    const { container } = render(<SportIllustration sport="badminton" />);
    const svg = container.querySelector("svg");
    expect(svg?.querySelector("animate")).toBeNull();
    expect(svg?.querySelector("animateTransform")).toBeNull();
    expect(svg?.querySelector("set")).toBeNull();
  });

  it("paints from the illustration tokens, not from baked-in colours", async () => {
    const { SportIllustration } = await loadModules();
    const { container } = render(<SportIllustration sport="swimming" />);
    const svg = container.querySelector("svg");
    const painted = Array.from(svg?.querySelectorAll("[fill],[stroke]") ?? [])
      .map((node) => node.getAttribute("fill") ?? node.getAttribute("stroke") ?? "")
      .join(" ");
    expect(painted).toContain("var(--illustration-");
  });
});
