// Known-good sibling for the known-bad ops-action fixture: an exported
// action that routes through opsAction(). Parsed, never executed.

declare function opsAction<T>(
  input: unknown,
  fn: () => Promise<T>,
): Promise<T>;

export async function updateSomethingAction(): Promise<{ ok: true }> {
  return opsAction({ scope: "feature.update" }, async () => ({ ok: true }));
}
