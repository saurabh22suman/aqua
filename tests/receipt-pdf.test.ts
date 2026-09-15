import { describe, expect, it } from "vitest";
import {
  buildContentStream,
  estimateTextWidthPt,
  renderPdf,
  sanitisePdfText,
} from "@/lib/receipts/pdf";

// C-39 — the dependency-free PDF writer's contract: a structurally
// valid PDF 1.4 (header, objects, an xref table whose offsets actually
// point at the objects, trailer, EOF), Latin-1-safe text, and
// deterministic output.

function xrefOffsets(pdf: string): number[] {
  // "startxref" also contains "xref\n"-like text, so anchor on the
  // subsection header itself.
  const start = pdf.indexOf("xref\n0 ");
  const lines = pdf.slice(start + "xref\n".length).split("\n");
  // lines[0] is the subsection header ("0 7"), lines[1] the free entry.
  return lines
    .filter((line) => /^\d{10} \d{5} n/.test(line))
    .map((line) => Number(line.slice(0, 10)));
}

describe("renderPdf", () => {
  it("produces a valid skeleton with correct xref offsets", () => {
    const pdf = renderPdf([
      { kind: "text", x: 40, y: 700, size: 12, text: "Hello" },
      { kind: "rect", x: 0, y: 800, width: 595, height: 42, color: [1, 0.5, 0] },
      { kind: "line", x1: 40, y1: 100, x2: 555, y2: 100 },
    ]).toString("latin1");

    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(pdf).toContain("/Type /Catalog");
    expect(pdf).toContain("/BaseFont /Helvetica");
    expect(pdf).toContain("startxref");

    const offsets = xrefOffsets(pdf);
    expect(offsets).toHaveLength(6);
    offsets.forEach((offset, index) => {
      expect(pdf.slice(offset, offset + 3)).toBe(`${index + 1} 0`);
    });
  });

  it("is deterministic for the same ops", () => {
    const ops = [
      { kind: "text" as const, x: 10, y: 10, size: 10, text: "Same" },
    ];
    expect(renderPdf(ops).equals(renderPdf(ops))).toBe(true);
  });

  it("escapes parentheses and backslashes in text", () => {
    const stream = buildContentStream([
      {
        kind: "text",
        x: 0,
        y: 0,
        size: 10,
        text: "Plan (monthly) \\ combo",
      },
    ]);
    expect(stream).toContain("Plan \\(monthly\\) \\\\ combo");
  });

  it("maps characters a base-14 font cannot draw", () => {
    expect(sanitisePdfText("\u20b92,500")).toBe("Rs.2,500");
    expect(sanitisePdfText("a\u2014b\u2013c")).toBe("a-b-c");
    expect(sanitisePdfText("\u2018x\u2019 \u201cy\u201d")).toBe("'x' \"y\"");
    expect(sanitisePdfText("\u0939")).toBe("?");
  });

  it("estimates text width monotonically", () => {
    expect(estimateTextWidthPt("", 10)).toBe(0);
    expect(estimateTextWidthPt("abc", 10)).toBeGreaterThan(0);
    expect(estimateTextWidthPt("abcdef", 10)).toBeGreaterThan(
      estimateTextWidthPt("abc", 10),
    );
  });
});
