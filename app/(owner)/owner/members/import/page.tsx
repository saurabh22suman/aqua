import Link from "next/link";
import { BackLink } from "@/components/ui/BackLink";
import { MemberImportForm } from "@/components/member-import-form";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";

// PR2-C5 — member import, step 1: check the file. The commit step
// lands in PR2-C6 on the same preview.
//
// P2 (2026-10-13 owner-UI review) — the page-level gate now matches
// the actions: import is a members.write surface, so a role with only
// members.read never sees the form. The actions still enforce the
// permission independently.
export default async function MemberImportPage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "members.write");
  return (
    <OwnerPage className="max-w-3xl">
      <BackLink href="/owner/members" label="Members" />

      <PageHeader
        className="mt-2"
        title="Import members"
        purpose="Bring an existing register across from a spreadsheet. Nothing is saved until you confirm the checked rows."
      />

      <p className="mt-3 text-[13px]">
        <Link
          href="/owner/members/import/template.csv"
          className="text-[var(--accent-ink)] underline underline-offset-2"
        >
          Download the CSV template
        </Link>
      </p>

      <div className="mt-5">
        <MemberImportForm />
      </div>
    </OwnerPage>
  );
}
