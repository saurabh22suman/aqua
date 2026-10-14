// Known-good sibling for the known-bad ops-action fixture: an exported
// action that routes through opsAction() and calls the authoritative
// admin guard. Parsed, never executed.

declare function opsAction<T>(
  input: unknown,
  fn: () => Promise<T>,
): Promise<T>;

declare function requireOpsAdminAction(): Promise<
  { kind: "ok"; userId: string } | { kind: "error"; reason: string }
>;

export async function updateSomethingAction(): Promise<{ ok: true }> {
  const status = await requireOpsAdminAction();
  if (status.kind === "error") return { ok: true };
  return opsAction({ scope: "feature.update" }, async () => ({ ok: true }));
}
