import Link from "next/link";
import { STAFF_CARD } from "@/components/staff-ui/staff-page";

export function StaffInboxLink({ href }: { href: string }) {
  return (
    <Link href={href} className={`mt-4 flex min-h-14 items-center px-4 py-3 font-medium text-ink ${STAFF_CARD}`}>
      Announcements
    </Link>
  );
}
