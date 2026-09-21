import { notFound } from "next/navigation";
import { requireReception } from "@/lib/auth/surface-guard";

// V-04 — reception booking counter, hidden for the pilot (PR1-C5).
// The screen's price resolver needs V-05/V-06 price-rule admin UI;
// without it every slot is a disabled "No price is configured for
// this slot" dead end. The tile is removed from /reception and this
// route 404s until that UI ships. The service layer and
// BookingScreen component remain for the owner-side booking work.

export default async function ReceptionBookingsPage() {
  await requireReception();
  notFound();
}
