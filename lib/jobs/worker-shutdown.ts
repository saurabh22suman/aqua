// PR1-C8 — graceful worker shutdown. Extracted from worker/index.ts so
// the drain contract is unit-testable without starting pg-boss:
// stop once, clear the heartbeat, exit 0; a second signal during the
// drain is ignored (the orchestrator's kill escalation handles a hung
// drain); a drain error is logged and still exits 0 so the container
// doesn't crash-loop on the way out.

export function createShutdownHandler({
  stop,
  clearHeartbeat,
  exit,
  log = (message: string) => console.log(message),
}: {
  stop: () => Promise<void>;
  clearHeartbeat: () => void;
  exit: (code: number) => void;
  log?: (message: string) => void;
}): (signal: string) => Promise<void> {
  let shuttingDown = false;

  return async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`[worker] ${signal} received — draining in-flight jobs`);
    clearHeartbeat();
    try {
      await stop();
    } catch (err) {
      log(
        `[worker] drain failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    exit(0);
  };
}
