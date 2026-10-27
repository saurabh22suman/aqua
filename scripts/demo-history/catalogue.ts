import type { PaymentMethodKey } from "@/lib/money/payment-groups";

// The planner's catalogue.
//
// Every constant that decides WHAT the synthetic history looks like
// lives here: the hours of the day money arrives, the shape of the
// dues calendar, the weights of the payment methods and of the payment
// outcomes, and the invented names the enquiries are filed under.
//
// The method and outcome mixes are WEIGHTED ROTATIONS rather than
// per-invoice coin flips: a rotation guarantees that every method and
// every outcome actually occurs in the history, so a reviewer always
// sees the full shape of the doughnut and the dues list. The dates,
// the amounts and the hours stay hash-driven.

export const PAYMENT_WALL_TIMES = [
  "07:40",
  "09:15",
  "11:05",
  "12:30",
  "16:20",
  "17:45",
  "19:10",
] as const;

export const ENQUIRY_WALL_TIMES = [
  "10:05",
  "11:40",
  "13:15",
  "16:45",
  "18:30",
] as const;

/**
 * The dues calendar: the invoice for a membership cycle goes out a week
 * BEFORE the cycle starts (the renewal invoice an owner actually
 * sends), and is due a week after it starts. Money then arrives over
 * the fortnight that follows, so the collections curve has money on
 * ordinary days and quiet days in between.
 */
export const INVOICE_LEAD_DAYS = 7;
export const INVOICE_DUE_DAYS = 7;

/** Weights, not a uniform choice — an academy collects mostly by UPI. */
export const PAYMENT_METHOD_PATTERN: PaymentMethodKey[] = [
  "upi",
  "upi",
  "upi",
  "cash",
  "cash",
  "cash",
  "card",
  "bank_transfer",
  "other",
];

/** paid / part-paid / paid-late / two instalments / unpaid. */
export const OUTCOME_PATTERN = [
  "paid",
  "paid",
  "paid",
  "paid",
  "paid",
  "paid",
  "partial",
  "partial",
  "late",
  "split",
  "unpaid",
  "unpaid",
] as const;

export type PaymentOutcome = (typeof OUTCOME_PATTERN)[number];

export const ENQUIRY_STAGES = [
  "new",
  "new",
  "contacted",
  "contacted",
  "trial_scheduled",
  "trial_completed",
  "converted",
  "converted",
  "lost",
] as const;

export const ENQUIRY_SOURCES = [
  "walk-in",
  "phone",
  "referral",
  "online",
  "online",
  "other",
] as const;

// Invented names, disjoint from the demo seed's roster, so a synthetic
// enquiry is never mistaken for one of the seeded members.
export const FIRST_NAMES = [
  "Aditi",
  "Rehan",
  "Saanvi",
  "Nikhil",
  "Trisha",
  "Yash",
  "Pooja",
  "Farhan",
  "Sana",
  "Meher",
  "Zoya",
  "Om",
  "Tara",
  "Dev",
  "Ira",
  "Kunal",
];

export const LAST_NAMES = [
  "Chauhan",
  "Rathore",
  "Fernandes",
  "Saxena",
  "Ghosh",
  "Kapoor",
  "Deshpande",
  "Malhotra",
  "Banerjee",
  "Trivedi",
  "Gaikwad",
  "Thakur",
  "Chavan",
  "Salvi",
  "More",
  "Shetty",
];
