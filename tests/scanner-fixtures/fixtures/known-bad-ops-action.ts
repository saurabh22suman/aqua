// Known-bad fixture for scripts/check-ops-actions.ts. This file is
// parsed by the scanner and never executed; it exists to prove the
// scan flags an exported platform action that mutates without going
// through opsAction(). Do not add this to any allowlist.

export async function updateSomethingAction(): Promise<{ ok: true }> {
  // A mutation with no opsAction() call — the scanner must flag this.
  return { ok: true };
}
