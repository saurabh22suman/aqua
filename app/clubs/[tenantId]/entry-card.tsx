import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/PageHeader";

export function ClubEntryCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-xl content-start gap-4 px-4 py-8 sm:py-12">
      <section className="min-w-0 rounded-card border border-line bg-paper p-4 [overflow-wrap:anywhere] sm:p-6">
        <PageHeader title={title} />
        <div className="mt-4 border-t border-line pt-4">{children}</div>
      </section>
    </main>
  );
}
