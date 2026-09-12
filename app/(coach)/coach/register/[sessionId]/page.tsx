import Link from "next/link";
import { getRosterAction } from "@/lib/actions/coach";
import { RegisterBoard } from "@/components/register-board";
import { OFFLINE_SYNC_ENABLED } from "@/lib/feature-flags";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { resolveTerm, titleCase } from "@/lib/terminology/keys";
import { requireCoach } from "@/lib/auth/surface-guard";

export default async function RegisterPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  await requireCoach();
  const { sessionId } = await params;
  const [data, terminology] = await Promise.all([
    getRosterAction(sessionId),
    // L3 audit — the empty-state copy (`Session not found`) routes
    // through the closed-key resolver. No current preset overrides
    // `session`, but the uniform contract is what keeps a future
    // preset (e.g. a "sparring" tennis preset) from drifting
    // silently. The fetch is cheap and only paid once per page.
    getTerminologyAction(),
  ]);

  if (!data) {
    return (
      <main className="px-5 pt-10">
        <p className="text-[15px] font-medium">
          {titleCase(resolveTerm(terminology, "session", 1))} not found
        </p>
        <Link href="/coach" className="mt-2 inline-flex items-center min-h-[44px] text-[13px] text-ink-3 underline">
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
      {/* min-h-44px target: the old 13px inline link was ~20px tall,
          unreachable one-handed mid-register. [automatable] */}
      <Link href="/coach" className="inline-flex items-center min-h-[44px] text-[13px] text-ink-3 underline underline-offset-2">
        ← Today
      </Link>
      <h1 className="mt-2 font-display text-[19px] font-semibold text-marine">
        {time} · {data.batchName}
      </h1>

      <div className="mt-4">
        <RegisterBoard
          sessionId={sessionId}
          rows={data.rows}
          offlineSyncEnabled={data.offlineSyncEnabled && OFFLINE_SYNC_ENABLED}
          terminology={terminology}
        />
      </div>
    </main>
  );
}
