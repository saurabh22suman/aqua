// Shared DOM helpers for the report-chart acceptance tests.
//
// The charts are server-rendered inline SVG, so the tests read the
// rendered geometry instead of the React tree: what the browser would
// draw (lines, dots, gridlines, axis text) rather than what the source
// happens to call things. A class-name assertion cannot tell a line
// that crosses an unrecorded day from one that stops at it, so the
// helpers below return the drawn geometry itself.

export function svgByLabel(name: RegExp): SVGSVGElement {
  const found = Array.from(
    document.querySelectorAll<SVGSVGElement>("svg[role='img']"),
  ).filter((svg) => name.test(svg.getAttribute("aria-label") ?? ""));
  if (found.length !== 1) {
    throw new Error(
      `expected exactly one chart labelled ${name}, found ${found.length}`,
    );
  }
  return found[0]!;
}

/** The raw geometry attribute of every drawable the chart emitted. */
export function rawDrawables(svg: SVGSVGElement): string[] {
  return Array.from(svg.querySelectorAll("path, polyline")).map((el) =>
    (el.getAttribute("d") ?? el.getAttribute("points") ?? "").trim(),
  );
}

/**
 * The drawn lines, as flat [x1, y1, x2, y2] coordinate lists. One
 * entry per drawn segment. The trend is drawn as <line> elements: a
 * polyline's points are numeric pairs, so the percentage positions
 * this chart needs cannot live there.
 */
export function drawnLines(svg: SVGSVGElement): number[][] {
  const lines: number[][] = [];
  for (const el of Array.from(svg.querySelectorAll("line.stroke-water"))) {
    const numbers = ["x1", "y1", "x2", "y2"].map((name) =>
      Number.parseFloat(el.getAttribute(name) ?? ""),
    );
    if (numbers.every((value) => Number.isFinite(value))) lines.push(numbers);
  }
  for (const el of Array.from(svg.querySelectorAll("path, polyline"))) {
    const raw = (el.getAttribute("d") ?? el.getAttribute("points") ?? "").trim();
    if (!raw) continue;
    const chunks =
      el.tagName.toLowerCase() === "polyline" ? [raw] : raw.split(/M/i).filter(Boolean);
    for (const chunk of chunks) {
      const numbers = (chunk.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
      const vertices: number[] = [];
      for (let i = 0; i + 1 < numbers.length; i += 2) {
        vertices.push(numbers[i]!, numbers[i + 1]!);
      }
      if (vertices.length >= 4) lines.push(vertices);
    }
  }
  return lines;
}

/** The horizontal gridlines of the plot, as y coordinates. */
export function gridLines(svg: SVGSVGElement): number[] {
  return Array.from(svg.querySelectorAll("line.stroke-line"))
    .map((line) => Number(line.getAttribute("y1")))
    .filter((y) => Number.isFinite(y));
}

/** The plotted dots, as {x, y} pairs in the SVG's own coordinates. */
export function plottedDots(svg: SVGSVGElement): Array<{ x: number; y: number }> {
  return Array.from(svg.querySelectorAll("circle")).map((dot) => ({
    x: Number.parseFloat(dot.getAttribute("cx") ?? ""),
    y: Number.parseFloat(dot.getAttribute("cy") ?? ""),
  }));
}

/** Every text string the chart rendered (axis labels and titles). */
export function chartText(svg: SVGSVGElement): string[] {
  return Array.from(svg.querySelectorAll("text"))
    .map((node) => (node.textContent ?? "").trim())
    .filter(Boolean);
}
