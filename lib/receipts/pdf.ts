// C-39 — a minimal, dependency-free PDF 1.4 writer.
//
// A receipt is one A4 page of text, rules and a coloured header band;
// pulling in a full PDF toolkit for that would be a dependency the
// repo does not otherwise need. This writer emits exactly the objects
// that shape needs: a catalog, one page, two base-14 fonts
// (Helvetica / Helvetica-Bold, so nothing is embedded), a content
// stream, an xref table and a trailer. Text is encoded as Latin-1
// (WinAnsi) with typographic characters mapped down — the rupee sign
// cannot be drawn with a base-14 font, so amounts print as "Rs." per
// the C-39 decision.
//
// The output is deterministic: the same ops produce byte-identical
// PDFs, which is what makes the receipts get-or-create cache safe.

export type PdfColor = readonly [number, number, number];

export type PdfOp =
  | {
      kind: "text";
      x: number;
      y: number;
      size: number;
      text: string;
      bold?: boolean;
      color?: PdfColor;
    }
  | {
      kind: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
      color: PdfColor;
    }
  | {
      kind: "line";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      color?: PdfColor;
      width?: number;
    };

export const A4_WIDTH_PT = 595;
export const A4_HEIGHT_PT = 842;

const BLACK: PdfColor = [0, 0, 0];

function rgb(color: PdfColor): string {
  return `${color[0]} ${color[1]} ${color[2]}`;
}

// WinAnsi-base-14 fonts cover Latin-1. Map the typographic characters
// a tenanted UI produces down to their plain equivalents; anything
// still outside Latin-1 becomes "?" rather than corrupting the stream.
export function sanitisePdfText(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "\u2014" || ch === "\u2013") out += "-";
    else if (ch === "\u20b9") out += "Rs.";
    else if (ch === "\u2018" || ch === "\u2019") out += "'";
    else if (ch === "\u201c" || ch === "\u201d") out += '"';
    else if (ch === "\u00a0") out += " ";
    else if (code <= 0xff) out += ch;
    else out += "?";
  }
  return out;
}

function escapeLiteral(text: string): string {
  return sanitisePdfText(text)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

export function buildContentStream(ops: PdfOp[]): string {
  const parts: string[] = [];
  for (const op of ops) {
    if (op.kind === "rect") {
      parts.push(
        `${rgb(op.color)} rg ${op.x} ${op.y} ${op.width} ${op.height} re f`,
      );
    } else if (op.kind === "line") {
      const color = op.color ?? BLACK;
      parts.push(
        `${rgb(color)} RG ${op.width ?? 0.75} w ${op.x1} ${op.y1} m ${op.x2} ${op.y2} l S`,
      );
    } else {
      const font = op.bold ? "/F2" : "/F1";
      const color = op.color ?? BLACK;
      parts.push(
        `${rgb(color)} rg BT ${font} ${op.size} Tf ${op.x} ${op.y} Td (${escapeLiteral(op.text)}) Tj ET`,
      );
    }
  }
  return `${parts.join("\n")}\n`;
}

export function renderPdf(
  ops: PdfOp[],
  options: { widthPt?: number; heightPt?: number } = {},
): Buffer {
  const width = options.widthPt ?? A4_WIDTH_PT;
  const height = options.heightPt ?? A4_HEIGHT_PT;
  const content = buildContentStream(ops);

  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ` +
      "/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}endstream`,
  ];

  let body = "";
  const offsets: number[] = [];
  const header = "%PDF-1.4\n";
  let offset = Buffer.byteLength(header, "latin1");

  for (let i = 0; i < objects.length; i += 1) {
    offsets[i] = offset;
    const chunk = `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
    body += chunk;
    offset += Buffer.byteLength(chunk, "latin1");
  }

  const xrefOffset = offset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const objectOffset of offsets) {
    xref += `${String(objectOffset).padStart(10, "0")} 00000 n \n`;
  }

  const trailer =
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(header + body + xref + trailer, "latin1");
}

// Helvetica has no metrics tables in a base-14 writer, so right-align
// helpers need an estimate. 0.52 em average covers digits and upper
// case closely enough for a receipt's right-aligned amounts.
export function estimateTextWidthPt(text: string, size: number): number {
  return sanitisePdfText(text).length * size * 0.52;
}
