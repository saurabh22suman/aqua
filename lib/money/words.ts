// Amount in words, Indian numbering (lakh = 10^5, crore = 10^7) —
// receipts and invoices in India print the amount this way
// ("Rupees Two Lakh Fifty Thousand and Fifty Paise Only") alongside
// the figures. Display only: integer paise in, a string out; never
// parsed back into arithmetic (lib/money/format.ts governs that
// direction).

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
] as const;

const TENS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
] as const;

function twoDigits(n: number): string {
  if (n < 20) return ONES[n]!;
  const tens = TENS[Math.floor(n / 10)]!;
  const ones = ONES[n % 10]!;
  return ones ? `${tens} ${ones}` : tens;
}

function threeDigits(n: number): string {
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundred > 0) parts.push(`${ONES[hundred]} Hundred`);
  if (rest > 0) parts.push(twoDigits(rest));
  return parts.join(" ");
}

// Indian grouping: crore, lakh, thousand, hundred, tens.
function rupeesInWords(n: number): string {
  if (n === 0) return "Zero";
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1_000);
  const remainder = n % 1_000;

  const parts: string[] = [];
  if (crore > 0) parts.push(`${rupeesInWords(crore)} Crore`);
  if (lakh > 0) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand > 0) parts.push(`${twoDigits(thousand)} Thousand`);
  if (remainder > 0) parts.push(threeDigits(remainder));
  return parts.join(" ");
}

export function amountInWords(paise: number): string {
  if (!Number.isInteger(paise) || paise < 0) {
    throw new Error(
      `amountInWords expects non-negative integer paise, got ${paise}`,
    );
  }
  const rupees = Math.floor(paise / 100);
  const remainderPaise = paise % 100;

  const parts = [`Rupees ${rupeesInWords(rupees)}`];
  if (remainderPaise > 0) {
    parts.push(`${twoDigits(remainderPaise)} Paise`);
  }
  return `${parts.join(" and ")} Only`;
}
