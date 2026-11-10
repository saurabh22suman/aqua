import type { readSelfBilling } from "@/lib/services/self-billing";
import { formatINR } from "@/lib/money/format";
import { BackLink } from "@/components/ui/BackLink";
type Billing = NonNullable<Awaited<ReturnType<typeof readSelfBilling>>>;
export function SelfBilling({ data, receiptBase, homeHref }: { data: Billing; receiptBase: string; homeHref: "/member" | "/family" }) {
  return <main className="mx-auto max-w-xl px-4 py-8"><BackLink href={homeHref} label={homeHref === "/member" ? "Member home" : "Family home"} /><h1 className="font-display text-2xl">Fees and payments</h1>
    <section className="mt-6"><h2 className="font-semibold">Outstanding fees (up to 10)</h2>{data.outstanding.length === 0 ? <p>No fees due.</p> : <ul>{data.outstanding.map(x => <li key={x.id} className="border-b py-3"><span>{x.invoiceNumber} · Due {x.dueOn}</span><p>{formatINR(x.outstandingPaise)} outstanding</p></li>)}</ul>}</section>
    <section className="mt-6"><h2 className="font-semibold">Recent payments (up to 8)</h2>{data.payments.length === 0 ? <p>No payments recorded yet.</p> : <ul>{data.payments.map(x => <li key={x.id} className="border-b py-3"><span>{formatINR(x.amountPaise)} · {x.method}{x.invoiceNumber ? ` · ${x.invoiceNumber}` : ""}</span>{x.invoiceNumber ? <form method="post" action={`${receiptBase}/${x.id}`}><button className="underline" type="submit">Download receipt</button></form> : <p>No invoice receipt for this payment.</p>}</li>)}</ul>}</section>
  </main>;
}
