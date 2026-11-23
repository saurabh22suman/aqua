import Link from "next/link";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { buttonClasses } from "@/components/ui/Button";
import { hasPermission } from "@/lib/auth/permission";
import type { Ctx } from "@/lib/auth/context";

export function StaffWorkdayLink({ ctx, href }: { ctx: Ctx; href: string }) {
  if (!hasPermission(ctx, "staff.self")) return null;
  return (
    <Link href={href} className={buttonClasses({ variant: "secondary", size: "sm", className: "mt-3" })}>
      <OwnerIcon name="check" size={16} />
      My workday
    </Link>
  );
}
