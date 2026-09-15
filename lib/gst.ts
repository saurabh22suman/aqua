// India-specific GST helpers (C-32/C-39).
//
// The academy bills its members for coaching and facility services.
// Two document kinds exist under the CGST Rules:
//   * Tax Invoice — issued by a GST-registered supplier. Carries the
//     supplier's GSTIN, a consecutive serial number (<= 16 characters,
//     Rule 46(b)), the SAC for services, and the CGST + SGST split.
//   * Bill of Supply — issued when the supplier is not registered (or
//     the supply is exempt). No tax is charged. An unregistered
//     supplier cannot collect GST, so the tenant's GSTIN presence is
//     the single switch.
//
// Intra-state only, by construction: one tenant = one GSTIN
// (2026-09-14 decision) and B2C services are supplied at the
// supplier's location, so the split is CGST + SGST. IGST (inter-state)
// is not modelled yet — see the C-32 PR note. The odd paise of an
// odd tax amount goes to SGST so cgst + sgst == tax exactly.

export const GST_RATE_BP_DEFAULT = 1800;

// 15 characters: 2-digit state code, 10-character PAN, entity number,
// a 'Z', and a checksum character. Same expression tenant creation
// validates against (db/platform-tenant-create.ts imports this now).
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function isValidGstin(value: string): boolean {
  return GSTIN_RE.test(value);
}

export function gstinStateCode(gstin: string): string | null {
  if (!GSTIN_RE.test(gstin)) return null;
  return gstin.slice(0, 2);
}

// Current GST state codes. 25 (Daman & Diu) and 28 (undivided Andhra)
// are deliberately absent: both were superseded in the 2017-2020
// reorganisation and no live GSTIN carries them.
export const GST_STATE_NAMES: Readonly<Record<string, string>> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
};

export function placeOfSupplyForGstin(
  gstin: string | null,
): string | null {
  if (!gstin) return null;
  const code = gstinStateCode(gstin);
  if (!code) return null;
  const name = GST_STATE_NAMES[code];
  return name ? `${name} (${code})` : null;
}

export type GstDocumentKind = "tax_invoice" | "bill_of_supply";

export function gstDocumentKind(gstin: string | null): GstDocumentKind {
  return gstin ? "tax_invoice" : "bill_of_supply";
}

export function gstDocumentLabel(kind: GstDocumentKind): string {
  return kind === "tax_invoice" ? "Tax Invoice" : "Bill of Supply";
}

// CGST + SGST are each half the notified rate on an intra-state
// supply. The full-rate tax is computed once (lib/money/arithmetic
// computeTax) and split here so the halves always sum to it exactly.
export function splitIntraStateTax(taxPaise: number): {
  cgstPaise: number;
  sgstPaise: number;
} {
  if (!Number.isInteger(taxPaise) || taxPaise < 0) {
    throw new Error(
      `splitIntraStateTax expects non-negative integer paise, got ${taxPaise}`,
    );
  }
  const cgstPaise = Math.floor(taxPaise / 2);
  return { cgstPaise, sgstPaise: taxPaise - cgstPaise };
}
