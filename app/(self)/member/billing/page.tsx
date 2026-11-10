import { notFound } from "next/navigation";
import { resolveScopedSelfScope } from "@/lib/auth/self-scope";
import { NotFoundError } from "@/lib/auth/context";
import { readSelfBilling } from "@/lib/services/self-billing";
import { BackLink } from "@/components/ui/BackLink";
import { SelfBilling } from "@/components/self-billing";
import { isBillingDeadlock } from "@/lib/services/self-billing-errors";
export const dynamic = "force-dynamic";
export default async function MemberBillingPage() {
  const resolver = await resolveScopedSelfScope("member"); if (!resolver) notFound();
  try { const data = await resolver.read((tx, scope) => readSelfBilling(tx, scope)); if (!data) notFound(); return <SelfBilling data={data} homeHref="/member" receiptBase="/api/self/billing/receipt" />; }
  catch (error) { if (error instanceof NotFoundError) notFound(); if (isBillingDeadlock(error)) return <main className="mx-auto max-w-xl px-4 py-8"><BackLink href="/member" label="Member home" /><h1>Fees and payments</h1><p>Unable to load fees right now. Please try again.</p></main>; throw error; }
}
