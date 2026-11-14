import PDFDocument from "pdfkit";
import { join } from "node:path";
import { buildReceiptPages, type ReceiptDocumentData } from "@/lib/receipts/receipt-document";
import { A4_HEIGHT_PT, type PdfColor } from "@/lib/receipts/pdf";

const SMALL_FONT_FAMILIES = new Set(["NotoSansDevanagari", "NotoSansKannada"]);
const FAMILIES = ["NotoSans", "NotoSansDevanagari", "NotoSansKannada", "NotoSansGujarati", "NotoSansGurmukhi", "NotoSansBengali", "NotoSansTamil", "NotoSansTelugu", "NotoSansMalayalam", "NotoSansOriya", "NotoSansArabic", "NotoSansOlChiki", "NotoSansMeeteiMayek"] as const;
type Font = { hasGlyphForCodePoint(cp: number): boolean; layout(text: string): { glyphs: Array<{ id: number }> } };
type Run = { font: string; text: string };
const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
const SCRIPT_FONTS: Array<[RegExp, string]> = [
  [/\p{Script=Devanagari}/u, "NotoSansDevanagari"], [/\p{Script=Kannada}/u, "NotoSansKannada"],
  [/\p{Script=Gujarati}/u, "NotoSansGujarati"], [/\p{Script=Gurmukhi}/u, "NotoSansGurmukhi"],
  [/\p{Script=Bengali}/u, "NotoSansBengali"], [/\p{Script=Tamil}/u, "NotoSansTamil"],
  [/\p{Script=Telugu}/u, "NotoSansTelugu"], [/\p{Script=Malayalam}/u, "NotoSansMalayalam"],
  [/\p{Script=Oriya}/u, "NotoSansOriya"], [/\p{Script=Arabic}/u, "NotoSansArabic"],
  [/\p{Script=Ol_Chiki}/u, "NotoSansOlChiki"], [/\p{Script=Meetei_Mayek}/u, "NotoSansMeeteiMayek"],
];

// PDFKit 0.20.2 exposes the fontkit instance on its embedded-font object.
// Keep this narrow boundary here; root owns the pinned dependency version.
function currentFont(doc: PDFKit.PDFDocument): Font {
  const embedded = doc as unknown as { _font?: { font?: Font } };
  if (!embedded._font?.font?.hasGlyphForCodePoint) throw new Error("Embedded receipt font unavailable");
  return embedded._font.font;
}

export async function renderUnicodeReceipt(data: ReceiptDocumentData): Promise<Buffer> {
  const doc = new PDFDocument({ autoFirstPage: false, compress: false, info: { CreationDate: new Date(0), ModDate: new Date(0) } });
  try {
    const fonts = new Map<string, Font>();
    for (const name of FAMILIES) for (const suffix of ["", "-Bold"]) {
      doc.registerFont(`${name}${suffix}`, join(process.cwd(), "assets/receipt-fonts", `${name}${suffix}.${SMALL_FONT_FAMILIES.has(name) ? "woff2" : "ttf"}`));
    }
    function font(name: string): Font {
      const cached = fonts.get(name);
      if (cached) return cached;
      doc.font(name);
      const loaded = currentFont(doc);
      fonts.set(name, loaded);
      return loaded;
    }
    function runs(text: string, bold = false): Run[] {
      if (text.length > 2048) throw new Error("Receipt text limit exceeded");
      const result: Run[] = [];
      for (const { segment } of segmenter.segment(text)) {
        if (/[\u0000-\u001f\u007f-\u009f]/u.test(segment)) throw new Error("Unsupported receipt control character");
        const previous = result.at(-1);
        const suffix = bold ? "-Bold" : "";
        const preferred = SCRIPT_FONTS.find(([script]) => script.test(segment))?.[1];
        const candidates = [...new Set([preferred ? preferred + suffix : previous?.font ?? `NotoSans${suffix}`, ...FAMILIES.map((name) => name + suffix)])];
        const selected = candidates.find((name) => {
          const face = font(name);
          return [...segment].every((ch) => face.hasGlyphForCodePoint(ch.codePointAt(0)!)) && face.layout(segment).glyphs.every((glyph) => glyph.id !== 0);
        });
        if (!selected) throw new Error("Unsupported receipt glyph");
        if (previous?.font === selected) previous.text += segment;
        else result.push({ font: selected, text: segment });
      }
      return result;
    }
    function width(text: string, size: number, bold = false): number {
      return runs(text, bold).reduce((sum, run) => sum + doc.font(run.font).fontSize(size).widthOfString(run.text), 0);
    }
    function wrap(text: string): string[] {
      if (text.length > 2048) throw new Error("Receipt text limit exceeded");
      const lines: string[] = [];
      let line = "";
      for (const { segment } of segmenter.segment(text)) {
        if (width(line + segment, 9) > 499) {
          if (!line) throw new Error("Receipt glyph exceeds line width");
          lines.push(line); line = segment;
          if (lines.length > 50) throw new Error("Receipt line limit exceeded");
        } else line += segment;
      }
      if (line) lines.push(line);
      return lines;
    }
    const pages = buildReceiptPages(data, wrap);
    if (pages.length > 2) throw new Error("Receipt page limit exceeded");
    // Validate everything before emitting or caching; never silently clip text.
    for (const page of pages) for (const op of page) if (op.kind === "text") {
      if (op.y < 60 || op.y > 820 || width(op.text, op.size, op.bold) > 595 - op.x) throw new Error("Receipt text does not fit");
    }
    const chunks: Buffer[] = [];
    const output = new Promise<Buffer>((resolve, reject) => {
      let size = 0;
      doc.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 4 * 1024 * 1024) { reject(new Error("Receipt PDF exceeds size limit")); doc.destroy(); }
        else chunks.push(chunk);
      });
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      doc.on("close", () => reject(new Error("Receipt PDF stream closed early")));
    });
    // A synchronous drawing error can occur before the output promise is awaited.
    void output.catch(() => {});
    const colour = (c?: PdfColor) => c ? c.map((v) => Math.round(v * 255)) as [number, number, number] : [0, 0, 0] as [number, number, number];
    for (const page of pages) {
      doc.addPage({ size: [595, 842], margin: 0 });
      for (const op of page) {
        if (op.kind === "rect") doc.fillColor(colour(op.color)).rect(op.x, 842 - op.y - op.height, op.width, op.height).fill();
        else if (op.kind === "line") doc.strokeColor(colour(op.color)).lineWidth(op.width ?? 0.75).moveTo(op.x1, 842 - op.y1).lineTo(op.x2, 842 - op.y2).stroke();
        else {
          let x = op.x;
          doc.fillColor(colour(op.color));
          doc.markContent("Span", { actual: op.text });
          for (const run of runs(op.text, op.bold)) {
            doc.font(run.font).fontSize(op.size).text(run.text, x, A4_HEIGHT_PT - op.y, { lineBreak: false, baseline: "alphabetic" });
            x += doc.widthOfString(run.text);
          }
          doc.endMarkedContent();
        }
      }
    }
    doc.end();
    return await output;
  } catch (error) {
    doc.destroy();
    throw error;
  }
}
