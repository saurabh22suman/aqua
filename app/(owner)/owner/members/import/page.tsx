import Link from "next/link";
import { BackLink } from "@/components/ui/BackLink";
import { MemberImportForm } from "@/components/member-import-form";
import { requireOwner } from "@/lib/auth/surface-guard";

// PR2-C5 — member import, step 1: check the file. The commit step
// lands in PR2-C6 on the same preview.
export default async function MemberImportPage() {
  await requireOwner();
  return (
    <main className="px-5 pt-6 pb-8">
      <BackLink href="/owner/members" label="Members" />

      <h1 className="font-display text-[19px] font-semibold">Import members</h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        Bring an existing register across from a spreadsheet. Nothing is
        saved until you confirm the checked rows.
      </p>

      <p className="mt-3 text-[13px]">
        <Link
          href="/owner/members/import/template.csv"
          className="text-[var(--accent)] underline underline-offset-2"
        >
          Download the CSV template
        </Link>
      </p>

      <div className="mt-5">
        <MemberImportForm />
      </div>
    </main>
  );
}
