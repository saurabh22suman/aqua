import { renderReceiptPdf, type ReceiptDocumentData } from "@/lib/receipts/receipt-document";

// Keep the PDFKit dependency outside the synchronous client-reachable renderer.
export async function renderIssuedReceipt(data: ReceiptDocumentData): Promise<Buffer> {
  const needsUnicode = [...JSON.stringify(data)].some((ch) => (ch.codePointAt(0) ?? 0) > 255);
  if (!needsUnicode) return renderReceiptPdf(data);
  const { renderUnicodeReceipt } = await import("@/lib/receipts/unicode-pdf");
  return renderUnicodeReceipt(data);
}
