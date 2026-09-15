// C-31 — pure invoice-numbering helpers. The financial year runs
// April 1 to March 31 (India), and the printed number carries the FY:
// `INV/2026-27/0001` (15 chars; GST caps the serial number at 16).

export function financialYearFor(dateIso: string): string {
  const [yearText, monthText] = dateIso.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`financialYearFor: invalid date "${dateIso}"`);
  }
  // Jan–Mar belong to the financial year that started the previous
  // April; Apr–Dec to the one that started this April.
  const startYear = month >= 4 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export function formatInvoiceNumber(
  financialYear: string,
  serial: number,
): string {
  if (!Number.isInteger(serial) || serial < 1) {
    throw new Error(`formatInvoiceNumber: invalid serial ${serial}`);
  }
  return `INV/${financialYear}/${String(serial).padStart(4, "0")}`;
}
