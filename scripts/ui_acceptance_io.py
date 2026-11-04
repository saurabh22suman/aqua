#!/usr/bin/env python3
"""Shared helpers for the local UI acceptance gate.

Kept separate from scripts/check-ui-acceptance.py so both modules stay
inside the 250-line budget and so the coercion and envelope rules live in
one place.

The coercion rules matter: a JSON value must never be turned into a usable
identity by string conversion. `str(None)` is the non-empty string "None",
so a null reviewer would otherwise pass as an identity. `text_of` therefore
returns "" for anything that is not a real string.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ACCEPTED = "ACCEPTED_WITHIN_SCOPE"
REJECTED = "REJECTED"
LOCAL_MODES = {"development", "dev", "local"}
RELEASE_REFUSAL = (
    "--release is refused: production artefact attestation is not implemented. "
    "Use the local scoped form for development evidence. A scoped acceptance "
    "never attests a production build."
)
PRODUCTION_REFUSAL = (
    "observed mode 'production' cannot be attested by this local checker: "
    "production artefact attestation is not implemented"
)
NOTE = (
    "A local scoped verdict about the named scope only. It is not a release "
    "gate and never a global READY. It validates the required review record "
    "and its hash bindings; it does not prove that an image was inspected or "
    "that a reviewer was independent in fact. See "
    "docs/audits/ui-acceptance-process-20261030/ for the full limitations."
)

__all__ = [
    "ACCEPTED",
    "LOCAL_MODES",
    "PRODUCTION_REFUSAL",
    "REJECTED",
    "RELEASE_REFUSAL",
    "build_result",
    "check_contract",
    "read_json",
    "require_pass",
    "require_text",
    "resolve_shot",
    "sha256_file",
    "status_of",
    "text_of",
    "verify_source_files",
]


def sha256_file(path: Path) -> str:
    """SHA-256 of a file's bytes, read in chunks."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path: Path, label: str) -> dict:
    """Read a JSON object. Failures are returned, not raised, so the
    checker can report every problem in one run."""
    try:
        raw = Path(path).read_text(encoding="utf-8")
    except FileNotFoundError:
        return {"__error__": f"{label} file not found: {path}"}
    except OSError as exc:
        return {"__error__": f"{label} file could not be read: {path}: {exc}"}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        return {"__error__": f"{label} file is not valid JSON: {path}: {exc}"}
    if not isinstance(parsed, dict):
        return {"__error__": f"{label} file must contain a JSON object: {path}"}
    return parsed


def text_of(value: object) -> str:
    """A real, trimmed string — or "" for null, numbers, lists and dicts.

    Never coerce with str(): str(None) is "None", which would let a null
    identity or verdict pass as a usable value.
    """
    if not isinstance(value, str):
        return ""
    return value.strip()


def status_of(entry: object) -> str:
    """The status of an assertion/functional entry.

    Accepts either {"status": "PASS"} or a bare "PASS" string. A missing
    or null status is "" — an empty result, never a pass.
    """
    raw = entry.get("status") if isinstance(entry, dict) else entry
    return text_of(raw)


def require_text(value: object, label: str, reasons: list[str]) -> str:
    """Require a real non-empty string. Returns "" and records a problem
    when the value is missing, null, or not a string."""
    result = text_of(value)
    if not result:
        reasons.append(f"{label} is required")
    return result


def require_pass(status: str, label: str, reasons: list[str]) -> None:
    """Require a PASS status. An empty status is 'required', not a pass."""
    if not status:
        reasons.append(f"{label} is required")
    elif status.lower() != "pass":
        reasons.append(f"{label} must be PASS (got '{status}')")


def resolve_shot(raw_path: str, evidence_dir: Path, source_root: Path | None) -> Path:
    """Resolve a screenshot path.

    Absolute paths are used as given. A relative path is tried against the
    evidence directory, then the source root, and finally the evidence
    directory again so the caller can report the path it was given.
    """
    candidate = Path(raw_path)
    if candidate.is_absolute():
        return candidate
    for base in (evidence_dir, source_root):
        if base is None:
            continue
        resolved = base / candidate
        if resolved.is_file():
            return resolved
    return evidence_dir / candidate


def verify_source_files(
    source_map: dict,
    source_root: Path | None,
    required_files: list[str],
    reasons: list[str],
) -> None:
    """Verify the evidence bound every file the contract required, and that
    each bound file still hashes the same.

    `source_map` is the evidence's sourceSha256 map. `required_files` are
    the paths the contract named. Extra hashed files are allowed — more
    binding is harmless — but each must exist and hash-match.
    """
    for rel in required_files:
        if rel not in source_map:
            reasons.append(
                f"evidence: required source file '{rel}' was not hashed — the "
                "contract requires it to be bound"
            )
    if source_root is None:
        return
    base = source_root.resolve()
    for relative, declared in sorted(source_map.items()):
        rel = str(relative)
        declared_hash = text_of(declared).lower()
        target = (base / rel).resolve()
        try:
            target.relative_to(base)
        except ValueError:
            reasons.append(f"source file '{rel}' resolves outside sourceRoot")
            continue
        if not target.is_file():
            reasons.append(f"source file '{rel}' is missing under sourceRoot")
        elif not declared_hash:
            reasons.append(f"source file '{rel}' has no recorded sha256")
        elif sha256_file(target) != declared_hash:
            reasons.append(
                f"source file '{rel}' changed since the evidence was recorded "
                "(stale source bytes)"
            )



def check_contract(contract: dict) -> tuple[str, list[str], dict, list[str]]:
    """Validate the contract: scope, required source files, and the per-case
    required assertion names. Returns scope, source files, cases, problems."""
    reasons: list[str] = []
    scope = require_text(contract.get("scope"), "contract: a scope name", reasons)
    source_files = contract.get("requiredSourceFiles")
    if not isinstance(source_files, list) or not source_files:
        reasons.append(
            "contract: requiredSourceFiles must be a non-empty list of the "
            "source files the evidence must bind"
        )
        source_files = []
    elif any(not isinstance(p, str) or not p.strip() for p in source_files):
        reasons.append("contract: requiredSourceFiles entries must be non-empty strings")
        source_files = []
    rows = contract.get("cases")
    if not isinstance(rows, list) or not rows:
        reasons.append("contract: cases list is required and must not be empty")
        return scope, source_files, {}, reasons
    required: dict[str, list[str]] = {}
    for row in rows:
        if not isinstance(row, dict):
            reasons.append("contract: every case must be an object")
            continue
        case_id = require_text(row.get("id"), "contract: a case id", reasons)
        if not case_id:
            continue
        if case_id in required:
            reasons.append(f"contract: duplicate case id '{case_id}'")
            continue
        names = row.get("requiredAssertions")
        if not isinstance(names, list) or not names:
            reasons.append(
                f"contract: case '{case_id}' must declare a non-empty "
                "requiredAssertions list — a case that demands nothing is refused"
            )
            names = []
        elif any(not isinstance(n, str) or not n.strip() for n in names):
            reasons.append(
                f"contract: case '{case_id}' requiredAssertions must be a list "
                "of non-empty strings"
            )
            names = []
        required[case_id] = [n.strip() for n in names]
    return scope, source_files, required, reasons



def build_result(
    scope: str, mode: str, required_files: list[str], cases: int, reasons: list[str]
) -> dict:
    """The result envelope. The verdict is scoped; it is never a global
    READY and never a release verdict."""
    return {
        "verdict": REJECTED if reasons else ACCEPTED,
        "scope": scope,
        "observedMode": mode,
        "release": False,
        "productionAttested": False,
        "cases": cases,
        "requiredSourceFiles": required_files,
        "reasons": reasons,
        "note": NOTE,
    }
