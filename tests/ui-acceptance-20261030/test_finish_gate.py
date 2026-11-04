#!/usr/bin/env python3
"""Regression suite for scripts/check-ui-acceptance.py (I1 / I3 / I5).

Executable:  python3 tests/ui-acceptance-20261030/test_finish_gate.py
Also runnable under pytest (stdlib-only assertions, no pytest import).

The checker is a LOCAL, scoped acceptance gate. It never emits a global
READY; the only accepting verdict is ACCEPTED_WITHIN_SCOPE, and --release
is refused outright until a real production attestation exists.

Fixtures are SYNTHETIC and written to a temp dir. They never assert that
any real Aqua route or artifact passed — root owns real reviews.
"""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixture import BUILDER, REVIEWER, Fixture, sha256_file  # noqa: E402


class CheckerTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.fx = Fixture(Path(self._tmp.name))

    def assertRejected(self, proc, needle: str) -> None:
        self.assertNotEqual(proc.returncode, 0, f"expected rejection, got 0: {proc.stdout}")
        self.assertIn(needle, proc.stdout + proc.stderr)

    def assertAccepted(self, proc) -> None:
        self.assertEqual(proc.returncode, 0, f"expected acceptance: {proc.stdout}{proc.stderr}")
        self.assertIn("ACCEPTED_WITHIN_SCOPE", proc.stdout)

    # -- happy path -------------------------------------------------
    def test_scoped_evidence_is_accepted(self) -> None:
        self.assertAccepted(self.fx.run())

    def test_acceptance_is_scoped_and_never_global_ready(self) -> None:
        proc = self.fx.run()
        self.assertAccepted(proc)
        self.assertNotIn("READY\n", proc.stdout)
        self.assertNotIn('"READY"', proc.stdout)
        self.assertNotIn("GLOBAL_READY", proc.stdout)

    def test_scope_name_is_reported(self) -> None:
        self.assertIn("owner-reports-charts-20261030", self.fx.run().stdout)

    def test_release_mode_is_refused_explicitly(self) -> None:
        proc = self.fx.run("--release")
        self.assertNotEqual(proc.returncode, 0)
        combined = proc.stdout + proc.stderr
        self.assertIn("release", combined.lower())
        self.assertIn("production", combined.lower())
        self.assertNotIn("ACCEPTED_WITHIN_SCOPE", combined)

    def test_release_refusal_does_not_depend_on_evidence_validity(self) -> None:
        self.fx.evidence["cases"] = []
        self.assertNotEqual(self.fx.run("--release").returncode, 0)

    def test_production_observed_mode_is_refused(self) -> None:
        self.fx.evidence["mode"] = "production"
        self.assertRejected(self.fx.run(), "production")

    # -- case-row integrity -------------------------------------
    def test_missing_case_row_is_rejected(self) -> None:
        self.fx.evidence["cases"] = self.fx.evidence["cases"][:1]
        self.assertRejected(self.fx.run(), "reports.attendance-trend")

    def test_duplicate_case_row_is_rejected(self) -> None:
        self.fx.evidence["cases"].append(dict(self.fx.evidence["cases"][0]))
        self.assertRejected(self.fx.run(), "duplicate")

    def test_extra_uncontracted_case_row_is_rejected(self) -> None:
        extra = dict(self.fx.evidence["cases"][0])
        extra["id"] = "reports.something-else"
        self.fx.evidence["cases"].append(extra)
        self.assertRejected(self.fx.run(), "extra")

    def test_empty_case_list_is_rejected(self) -> None:
        self.fx.evidence["cases"] = []
        self.assertRejected(self.fx.run(), "case")

    def test_functional_failure_is_rejected(self) -> None:
        self.fx.evidence["cases"][0]["functional"]["status"] = "FAIL"
        self.assertRejected(self.fx.run(), "functional")

    def test_missing_functional_status_is_rejected(self) -> None:
        del self.fx.evidence["cases"][0]["functional"]["status"]
        self.assertRejected(self.fx.run(), "functional")

    # -- rendered assertions -----------------------------------
    def test_missing_required_assertion_is_rejected(self) -> None:
        del self.fx.evidence["cases"][0]["assertions"]["arcs-inside-ring"]
        self.assertRejected(self.fx.run(), "arcs-inside-ring")

    def test_empty_required_assertion_is_rejected(self) -> None:
        self.fx.evidence["cases"][0]["assertions"]["arcs-inside-ring"] = {"status": ""}
        self.assertRejected(self.fx.run(), "arcs-inside-ring")

    def test_failed_required_assertion_is_rejected(self) -> None:
        self.fx.evidence["cases"][0]["assertions"]["arcs-inside-ring"] = {
            "status": "FAIL",
            "detail": "arcs outside ring",
        }
        self.assertRejected(self.fx.run(), "arcs-inside-ring")

    def test_assertion_names_come_from_the_contract_not_the_checker(self) -> None:
        """A contract may demand any assertion name; the checker must not
        impose a fixed vocabulary (no SVG<text>/axis rule, no whitespace
        threshold) of its own."""
        self.fx.contract["cases"][0]["requiredAssertions"] = [
            "card-height-within-content",
            "no-stranded-column",
        ]
        for name in ("card-height-within-content", "no-stranded-column"):
            self.fx.evidence["cases"][0]["assertions"][name] = {"status": "PASS"}
        self.assertAccepted(self.fx.run())

    def test_unrequired_extra_assertion_is_not_a_failure(self) -> None:
        self.fx.evidence["cases"][0]["assertions"]["some-extra-probe"] = {"status": "PASS"}
        self.assertAccepted(self.fx.run())

    # -- visual verdict ---------------------------------------
    def test_pending_visual_verdict_is_rejected(self) -> None:
        self.fx.evidence["cases"][0]["visualVerdict"] = "PENDING"
        self.assertRejected(self.fx.run(), "visual")

    def test_not_tested_visual_verdict_is_rejected(self) -> None:
        self.fx.evidence["cases"][0]["visualVerdict"] = "NOTTESTED"
        self.assertRejected(self.fx.run(), "visual")

    def test_changes_required_visual_verdict_is_rejected(self) -> None:
        self.fx.evidence["cases"][0]["visualVerdict"] = "CHANGES_REQUIRED"
        self.assertRejected(self.fx.run(), "visual")

    def test_missing_visual_verdict_is_rejected(self) -> None:
        del self.fx.evidence["cases"][0]["visualVerdict"]
        self.assertRejected(self.fx.run(), "visual")

    def test_reviewer_equal_to_builder_is_rejected(self) -> None:
        self.fx.evidence["cases"][0]["reviewer"] = BUILDER
        self.assertRejected(self.fx.run(), "reviewer")

    def test_missing_reviewer_is_rejected(self) -> None:
        del self.fx.evidence["cases"][0]["reviewer"]
        self.assertRejected(self.fx.run(), "reviewer")

    def test_missing_screenshot_file_is_rejected(self) -> None:
        self.fx.shot.unlink()
        self.assertRejected(self.fx.run(), "screenshot")

    def test_changed_screenshot_bytes_are_rejected(self) -> None:
        self.fx.shot.write_bytes(b"\x89PNG\r\n\x1a\nTAMPERED")
        self.assertRejected(self.fx.run(), "screenshot")

    def test_missing_screenshot_hash_is_rejected(self) -> None:
        del self.fx.evidence["cases"][0]["screenshot"]["sha256"]
        self.assertRejected(self.fx.run(), "screenshot")

    def test_stale_source_bytes_are_rejected(self) -> None:
        self.fx.src_file.write_text("export const Chart = () => null; // edited\n")
        self.assertRejected(self.fx.run(), "source")

    def test_missing_source_file_is_rejected(self) -> None:
        self.fx.src_file.unlink()
        self.assertRejected(self.fx.run(), "source")

    def test_source_hash_map_must_not_be_empty(self) -> None:
        self.fx.evidence["sourceSha256"] = {}
        self.assertRejected(self.fx.run(), "source")

    # -- hashes recomputed, not trusted ----------------------
    def test_checker_recomputes_hashes_rather_than_trusting_the_caller(self) -> None:
        """A caller claiming PASS with a stale hash must not be believed."""
        self.fx.evidence["cases"][0]["visualVerdict"] = "PASS"
        self.fx.evidence["cases"][0]["functional"]["status"] = "PASS"
        self.fx.src_file.write_text("export const Chart = () => null; // edited\n")
        self.assertRejected(self.fx.run(), "source")

    # -- D1: contract must demand something ----------------
    def test_contract_case_without_required_assertions_is_rejected(self) -> None:
        del self.fx.contract["cases"][0]["requiredAssertions"]
        self.assertRejected(self.fx.run(), "requiredAssertions")

    def test_contract_case_with_empty_required_assertions_is_rejected(self) -> None:
        self.fx.contract["cases"][0]["requiredAssertions"] = []
        self.assertRejected(self.fx.run(), "requiredAssertions")

    def test_contract_case_with_blank_assertion_name_is_rejected(self) -> None:
        self.fx.contract["cases"][0]["requiredAssertions"] = ["   "]
        self.assertRejected(self.fx.run(), "requiredAssertions")

    # -- D2: real strings, never coerced -------------------
    def test_null_reviewer_is_rejected(self) -> None:
        self.fx.evidence["cases"][0]["reviewer"] = None
        self.assertRejected(self.fx.run(), "reviewer")

    def test_null_visual_verdict_is_rejected(self) -> None:
        self.fx.evidence["cases"][0]["visualVerdict"] = None
        self.assertRejected(self.fx.run(), "visual")

    def test_null_builder_is_rejected(self) -> None:
        self.fx.evidence["builder"] = None
        self.assertRejected(self.fx.run(), "builder")

    def test_null_case_id_is_rejected(self) -> None:
        self.fx.evidence["cases"][0]["id"] = None
        self.assertRejected(self.fx.run(), "id")

    def test_non_string_reviewer_is_rejected(self) -> None:
        self.fx.evidence["cases"][0]["reviewer"] = 12345
        self.assertRejected(self.fx.run(), "reviewer")

    def test_null_functional_status_is_rejected(self) -> None:
        self.fx.evidence["cases"][0]["functional"]["status"] = None
        self.assertRejected(self.fx.run(), "functional")

    # -- D3: contract anchors the source binding -----------
    def test_evidence_must_hash_every_required_source_file(self) -> None:
        unrelated = self.fx.source_root / "README.md"
        unrelated.write_text("unrelated\n")
        self.fx.evidence["sourceSha256"] = {"README.md": sha256_file(unrelated)}
        self.assertRejected(self.fx.run(), "components/chart.tsx")

    def test_contract_without_required_source_files_is_rejected(self) -> None:
        del self.fx.contract["requiredSourceFiles"]
        self.assertRejected(self.fx.run(), "requiredSourceFiles")

    def test_contract_with_empty_required_source_files_is_rejected(self) -> None:
        self.fx.contract["requiredSourceFiles"] = []
        self.assertRejected(self.fx.run(), "requiredSourceFiles")

    def test_extra_hashed_source_file_is_allowed(self) -> None:
        """Extra binding is harmless: more files bound, not fewer."""
        unrelated = self.fx.source_root / "README.md"
        unrelated.write_text("unrelated\n")
        self.fx.evidence["sourceSha256"]["README.md"] = sha256_file(unrelated)
        self.assertAccepted(self.fx.run())


if __name__ == "__main__":
    unittest.main(verbosity=2)
