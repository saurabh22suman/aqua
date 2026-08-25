import Link from "next/link";
import { getRosterAction } from "@/lib/actions/coach";
import { RegisterBoard } from "@/components/register-board";

export default async function RegisterPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const data = await getRosterAction(sessionId);

  if (!data) {
    return (
      <main className="px-5 pt-10">
        <p className="text-[15px] font-medium">Session not found</p>
        <Link href="/coach" className="mt-2 inline-block text-[13px] text-ink-3 underline">
          Back to today
        </Link>
      </main>
    );
  }

  const time = new Date(data.startsAt).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });

  return (
    <main className="px-5 pt-6">
      <Link href="/coach" className="text-[13px] text-ink-3 underline underline-offset-2">
        ← Today
      </Link>
      <h1 className="mt-2 font-display text-[19px] font-semibold text-marine">
        {time} · {data.batchName}
      </h1>

      <div className="mt-4">
        <RegisterBoard sessionId={sessionId} rows={data.rows} />
      </div>
    </main>
  );
}
