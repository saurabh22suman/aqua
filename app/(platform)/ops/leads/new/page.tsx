import Link from "next/link";
import { redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { NewLeadForm } from "./new-lead-form";

export default async function NewLeadPage() {
  const status = await platformAuthStatusAction();
  if (status.kind !== "authenticated") redirect("/ops/login");

  return (
    <div className="max-w-2xl">
      <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
        <Link href="/ops/leads" className="hover:text-ink underline-offset-2 hover:underline">
          Leads
        </Link>
        {" / "}
        new
      </p>
      <h1 className="mt-2 font-display text-[28px] font-semibold text-marine">
        New lead
      </h1>
      <NewLeadForm />
    </div>
  );
}
