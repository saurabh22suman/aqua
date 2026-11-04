#!/usr/bin/env python3
"""Local UI finish gate — a SCOPED acceptance checker (I1 / I3 / I5).

--contract : scope name, the source files the evidence must bind, the
             required case ids, and per case the required rendered-assertion
             names.
--evidence : sourceRoot, a sourceSha256 map, the builder identity, the
             observed mode, and one row per case with its functional result,
             rendered assertions, visual verdict, reviewer and screenshot
             file+hash.

Every hash is RECOMPUTED here; a caller claiming PASS with a stale hash is
not believed. ACCEPTED_WITHIN_SCOPE means the contracted cases are covered
by independent, hash-bound evidence — a LOCAL, SCOPED statement about the
named scope, never a release verdict and never a global READY. REJECTED
lists every problem found.

The required-assertion vocabulary is NOT built in: it comes from the
contract, per case. There is no built-in SVG<text>/axis rule for donuts and
no global whitespace threshold. --release is refused outright because
production artefact attestation is not implemented and this checker does not
invent it.

WHAT THIS DOES NOT PROVE: this is a JSON checker. It validates the required
review record and its hash bindings; it cannot establish that a person
looked at an image or that a reviewer was independent in fact. A green run
is not evidence of visual truth and is not resistance to a dishonest agent.

The full rejection list, the rationale, the independent review and the
limitations: docs/audits/ui-acceptance-process-20261030/.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ui_acceptance_io import (  # noqa: E402
    ACCEPTED,
    LOCAL_MODES,
    PRODUCTION_REFUSAL,
    REJECTED,
    RELEASE_REFUSAL,
    build_result,
    check_contract,
    read_json,
    require_pass,
    require_text,
    resolve_shot,
    sha256_file,
    status_of,
    text_of,
    verify_source_files,
)




def check_case(
    case_id: str,
    row: dict,
    names: list[str],
    builder: str,
    evidence_dir: Path,
    source_root: Path | None,
    reasons: list[str],
) -> None:
    """Validate one evidence row against the contract's requirements."""

    def bad(message: str) -> None:
        reasons.append(f"case '{case_id}': {message}")

    functional = row.get("functional")
    if not isinstance(functional, dict):
        bad("a functional result is required")
    else:
        require_pass(status_of(functional), "functional status", reasons)
    assertions = row.get("assertions")
    if not isinstance(assertions, dict):
        assertions = {}
    for name in names:
        if name not in assertions:
            bad(f"required assertion '{name}' is missing")
            continue
        require_pass(status_of(assertions[name]), f"required assertion '{name}'", reasons)
    verdict = require_text(row.get("visualVerdict"), "a visualVerdict", reasons)
    if verdict and verdict.upper() != "PASS":
        bad(f"visualVerdict must be PASS (got '{verdict}')")
    reviewer = require_text(row.get("reviewer"), "a reviewer identity", reasons)
    if reviewer and builder and reviewer == builder:
        bad("the reviewer must be independent of the builder")
    shot = row.get("screenshot")
    if not isinstance(shot, dict):
        bad("a screenshot reference is required")
        return
    raw_path = require_text(shot.get("path"), "screenshot path", reasons)
    declared_hash = text_of(shot.get("sha256")).lower()
    if not raw_path:
        return
    if not declared_hash:
        bad("screenshot sha256 is required")
        return
    target = resolve_shot(raw_path, evidence_dir, source_root)
    if not target.is_file():
        bad(f"screenshot file is missing ({raw_path})")
        return
    actual = sha256_file(target)
    if actual != declared_hash:
        bad(
            "screenshot bytes changed since review "
            f"(recorded {declared_hash[:12]}, found {actual[:12]})"
        )


def check_evidence(
    evidence: dict,
    required: dict,
    required_files: list[str],
    evidence_dir: Path,
) -> tuple[str, list[str]]:
    """Validate the evidence document: identities, mode, row coverage, the
    source binding, and every contracted case."""
    reasons: list[str] = []
    builder = require_text(evidence.get("builder"), "evidence: a builder identity", reasons)
    mode = text_of(evidence.get("mode")).lower()
    if mode == "production":
        reasons.append(f"evidence: {PRODUCTION_REFUSAL}")
    elif mode not in LOCAL_MODES:
        reasons.append("evidence: mode must be 'development' (or 'dev'/'local')")
    root_raw = require_text(evidence.get("sourceRoot"), "evidence: sourceRoot", reasons)
    source_root = Path(root_raw) if root_raw else None
    rows = evidence.get("cases")
    if not isinstance(rows, list) or not rows:
        reasons.append("evidence: cases list is required and must contain a row per contracted case")
        rows = []
    by_id: dict[str, dict] = {}
    duplicates: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            reasons.append("evidence: every case row must be an object")
            continue
        case_id = require_text(row.get("id"), "evidence: a case row id", reasons)
        if not case_id:
            continue
        if case_id in by_id:
            duplicates.add(case_id)
            continue
        by_id[case_id] = row
    for case_id in sorted(duplicates):
        reasons.append(f"evidence: duplicate case row id '{case_id}'")
    for case_id in required:
        if case_id not in by_id:
            reasons.append(f"contract case '{case_id}' has no evidence row")
    for case_id in by_id:
        if case_id not in required:
            reasons.append(f"evidence: extra case row '{case_id}' is not in the contract")
    source_map = evidence.get("sourceSha256")
    if not isinstance(source_map, dict) or not source_map:
        reasons.append(
            "evidence: sourceSha256 map is required and must not be empty "
            "(no source bytes were bound to this evidence)"
        )
        source_map = {}
    verify_source_files(source_map, source_root, required_files, reasons)
    for case_id in sorted(required):
        row = by_id.get(case_id)
        if row is not None:
            check_case(
                case_id, row, required[case_id], builder, evidence_dir, source_root, reasons
            )
    return mode, reasons



def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Local scoped UI acceptance gate.")
    parser.add_argument("--contract", required=True, help="contract JSON path")
    parser.add_argument("--evidence", required=True, help="evidence JSON path")
    parser.add_argument(
        "--release",
        action="store_true",
        help="refused: production artefact attestation is not implemented",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    reasons: list[str] = []
    if args.release:
        reasons.append(RELEASE_REFUSAL)
    contract = read_json(Path(args.contract), "contract")
    evidence = read_json(Path(args.evidence), "evidence")
    scope = ""
    mode = ""
    required_files: list[str] = []
    for document in (contract, evidence):
        if "__error__" in document:
            reasons.append(str(document["__error__"]))
    if not reasons:
        scope, required_files, required, contract_reasons = check_contract(contract)
        reasons.extend(contract_reasons)
        evidence_dir = Path(args.evidence).resolve().parent
        mode, evidence_reasons = check_evidence(evidence, required, required_files, evidence_dir)
        reasons.extend(evidence_reasons)
    cases = contract.get("cases") if isinstance(contract, dict) else None
    print(
        json.dumps(
            build_result(
                scope, mode, required_files, len(cases) if isinstance(cases, list) else 0, reasons
            ),
            indent=2,
        )
    )
    return 0 if not reasons else 1


if __name__ == "__main__":
    sys.exit(main())
