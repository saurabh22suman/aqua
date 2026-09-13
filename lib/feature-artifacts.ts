// 2026-09-13 UI/UX audit X-D4 — the Ops feature catalogue (and the
// per-tenant feature list derived from the same table) showed dozens
// of auto-generated test fixtures ("resolver-mtz0kvwd-expiring",
// "tf-rls-…"), because the feature-resolution suites write to the
// shared dev database and their teardown does not always run (an
// interrupted suite leaves the rows orphaned). Operators see the
// debris on the one screen meant to be a source of truth.
//
// The tests under tests/tier1/** are a protected path this repo's
// agent workflow must not edit, so teardown cannot be fixed here.
// This is the audit's second option: filter the known test-fixture
// key shapes from the operator-facing views. The patterns are the
// exact `<prefix>-<base36 run>` shapes those suites generate; a real
// feature key would have to collide with one of these run ids to be
// hidden, and the catalogue remains editable in the database.
const TEST_ARTIFACT_KEY_RE =
  /^(?:resolver|tf|tf-rls|feat|feat-act)-[a-z0-9]{6,}(?:-|$)/;

export function isTestArtifactFeatureKey(key: string): boolean {
  return TEST_ARTIFACT_KEY_RE.test(key);
}

export function withoutTestArtifactFeatureKeys<T extends { key: string }>(
  rows: readonly T[],
): T[] {
  return rows.filter((row) => !isTestArtifactFeatureKey(row.key));
}
