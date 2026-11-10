import { notFound } from "next/navigation";
import { resolveScopedSelfScope } from "@/lib/auth/self-scope";
import { NotFoundError } from "@/lib/auth/context";
import { readSelfBilling } from "@/lib/services/self-billing";
import { BackLink } from "@/components/ui/BackLink";
import { SelfBilling } from "@/components/self-billing";
import { isBillingDeadlock } from "@/lib/services/self-billing-errors";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export default async function FamilyBillingPage({ params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params; if (!UUID.test(memberId)) notFound();
  const resolver = await resolveScopedSelfScope("guardian"); if (!resolver) notFound();
  try { const data = await resolver.read((tx, scope) => readSelfBilling(tx, scope, memberId)); if (!data) notFound(); return <SelfBilling data={data} homeHref="/family" receiptBase={`/api/family/billing/${memberId}/receipt`} />; }
  catch (error) { if (error instanceof NotFoundError) notFound(); if (isBillingDeadlock(error)) return <main className="mx-auto max-w-xl px-4 py-8"><BackLink href="/family" label="Family home" /><h1>Fees and payments</h1><p>Unable to load fees right now. Please try again.</p></main>; throw error; }
}
