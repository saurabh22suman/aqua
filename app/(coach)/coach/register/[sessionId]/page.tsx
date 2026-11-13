import { getRosterAction } from "@/lib/actions/coach";
import { RegisterBoard } from "@/components/register-board";
import { OFFLINE_SYNC_ENABLED } from "@/lib/feature-flags";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { resolveTerm, titleCase } from "@/lib/terminology/keys";
import { requireCoach } from "@/lib/auth/surface-guard";
import { formatDateIST, formatTimeIST } from "@/lib/time/tz";
import { requireUuidParam } from "@/lib/params";
import { BackLink } from "@/components/ui/BackLink";
import { StaffPage } from "@/components/staff-ui/staff-page";

export default async function RegisterPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  await requireCoach();
  const { sessionId } = await params;
  requireUuidParam(sessionId);
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
      <StaffPage>
        <BackLink href="/coach" label="Today" />
        <p className="text-[15px] font-medium text-ink">
          {titleCase(resolveTerm(terminology, "session", 1))} not found
        </p>
        <p className="mt-2 text-[13px] text-ink-3">
          This register is not part of your batches, or it no longer exists.
        </p>
      </StaffPage>
    );
  }

  const time = formatTimeIST(data.startsAt);

  return (
    <StaffPage className="px-5">
      <BackLink href="/coach" label="Today" />
      <h1 className="text-[20px] font-medium leading-tight tracking-[-0.01em] text-ink">
        {time} · {data.batchName}
      </h1>
      <p className="mt-1 text-[13px] text-ink-3">{formatDateIST(data.startsAt)}</p>
      <p className="mt-1 break-words text-[13px] text-ink-2">{data.locationName ? `Venue: ${data.locationName}` : "Venue not recorded"}</p>

      <div className="mt-4">
        <RegisterBoard
          sessionId={sessionId}
          rows={data.rows}
          offlineSyncEnabled={data.offlineSyncEnabled && OFFLINE_SYNC_ENABLED}
          offlineIdentity={data.offlineIdentity}
          terminology={terminology}
        />
      </div>
    </StaffPage>
  );
}
