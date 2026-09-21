import { requireOwner } from "@/lib/auth/surface-guard";
import { memberImportTemplateCsv } from "@/lib/services/member-import-csv";

// PR2-C5 — the import template. Canonical headers plus one example
// row; downloading it is the first step of every import.
export async function GET() {
  await requireOwner();
  return new Response(memberImportTemplateCsv(), {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="member-import-template.csv"',
    },
  });
}
