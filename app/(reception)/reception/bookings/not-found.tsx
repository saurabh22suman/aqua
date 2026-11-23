import Link from "next/link";
import { buttonClasses } from "@/components/ui/Button";
import { StaffPage, StaffPageHeader } from "@/components/staff-ui/staff-page";

// An old bookmark can still reach the retired counter page.
export default function ReceptionBookingsNotFound() {
  return (
    <StaffPage className="max-w-xl">
      <StaffPageHeader title="Bookings" />
      <section
        aria-label="Bookings unavailable"
        className="mt-6 rounded-2xl border border-line bg-paper p-4"
      >
        <h2 className="text-[15px] font-medium text-ink">
          Bookings are unavailable at Reception
        </h2>
        <Link
          href="/reception"
          className={buttonClasses({
            variant: "secondary",
            size: "md",
            className: "mt-4",
          })}
        >
          Back to Reception
        </Link>
      </section>
    </StaffPage>
  );
}
