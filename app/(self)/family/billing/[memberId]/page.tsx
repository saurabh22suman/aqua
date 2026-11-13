import { notFound } from "next/navigation";
import { resolveScopedSelfScope } from "@/lib/auth/self-scope";
import { NotFoundError } from "@/lib/auth/context";
import { readSelfBilling } from "@/lib/services/self-billing";
import { BackLink } from "@/components/ui/BackLink";
import { SelfBilling } from "@/components/self-billing";
import { isBillingDeadlock } from "@/lib/services/self-billing-errors";
import { readSelfHome } from "@/lib/services/self-home";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export default async function FamilyBillingPage({ params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params; if (!UUID.test(memberId)) notFound();
  const resolver = await resolveScopedSelfScope("guardian"); if (!resolver) notFound();
  try {
    const result = await resolver.read(async (tx, scope) => {
      const data = await readSelfBilling(tx, scope, memberId);
      if (!data) return null;
      const home = await readSelfHome(tx, scope, "guardian");
      const child = home.entries.find((entry) => entry.memberId === memberId);
      return child ? { data, childName: child.fullName, memberCode: child.memberCode } : null;
    });
    if (!result) notFound();
    return <SelfBilling data={result.data} childName={result.childName} memberCode={result.memberCode} homeHref="/family" receiptBase={`/api/family/billing/${memberId}/receipt`} />;
  }
  catch (error) { if (error instanceof NotFoundError) notFound(); if (isBillingDeadlock(error)) return <main className="mx-auto max-w-xl px-4 py-8"><BackLink href="/family" label="Family home" /><h1>Fees and payments</h1><p>Unable to load fees right now. Please try again.</p></main>; throw error; }
}
