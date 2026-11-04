#!/usr/bin/env python3
"""Synthetic fixture builder for the local UI acceptance-gate regression.

Scaffolding, not a feature: it fabricates a contract/evidence pair in a
temp dir so the regression suite can drive the checker. It never asserts
that any real Aqua route or artifact passed — root owns real reviews.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
CHECKER = REPO / "scripts" / "check-ui-acceptance.py"
BUILDER = "ses_builder_aaa"
REVIEWER = "ses_reviewer_bbb"


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


class Fixture:
    """A synthetic source root + contract + evidence pair."""

    def __init__(self, root: Path):
        self.root = root
        self.source_root = root / "source"
        self.source_root.mkdir(parents=True, exist_ok=True)
        self.src_file = self.source_root / "components" / "chart.tsx"
        self.src_file.parent.mkdir(parents=True, exist_ok=True)
        self.src_file.write_text("export const Chart = () => null;\n")
        self.shot = root / "evidence" / "shot.png"
        self.shot.parent.mkdir(parents=True, exist_ok=True)
        self.shot.write_bytes(b"\x89PNG\r\n\x1a\nSYNTHETIC")
        self.contract = {
            "scope": "owner-reports-charts-20261030",
            "requiredSourceFiles": ["components/chart.tsx"],
            "cases": [
                {
                    "id": "reports.member-mix.donut",
                    "requiredAssertions": ["arcs-inside-ring", "legend-visible-in-card"],
                },
                {
                    "id": "reports.attendance-trend",
                    "requiredAssertions": ["readable-axis-labels"],
                },
            ],
        }
        self.evidence = {
            "sourceRoot": str(self.source_root),
            "sourceSha256": {"components/chart.tsx": sha256_file(self.src_file)},
            "builder": BUILDER,
            "mode": "development",
            "cases": [
                {
                    "id": "reports.member-mix.donut",
                    "functional": {"status": "PASS", "detail": "synthetic"},
                    "assertions": {
                        "arcs-inside-ring": {"status": "PASS"},
                        "legend-visible-in-card": {"status": "PASS"},
                    },
                    "visualVerdict": "PASS",
                    "reviewer": REVIEWER,
                    "screenshot": {
                        "path": str(self.shot),
                        "sha256": sha256_file(self.shot),
                    },
                },
                {
                    "id": "reports.attendance-trend",
                    "functional": {"status": "PASS", "detail": "synthetic"},
                    "assertions": {"readable-axis-labels": {"status": "PASS"}},
                    "visualVerdict": "PASS",
                    "reviewer": REVIEWER,
                    "screenshot": {
                        "path": str(self.shot),
                        "sha256": sha256_file(self.shot),
                    },
                },
            ],
        }

    def write(self) -> tuple[Path, Path]:
        c = self.root / "contract.json"
        e = self.root / "evidence.json"
        c.write_text(json.dumps(self.contract, indent=2))
        e.write_text(json.dumps(self.evidence, indent=2))
        return c, e

    def run(self, *extra: str) -> subprocess.CompletedProcess:
        c, e = self.write()
        return subprocess.run(
            [
                sys.executable,
                str(CHECKER),
                "--contract",
                str(c),
                "--evidence",
                str(e),
                *extra,
            ],
            capture_output=True,
            text=True,
            cwd=str(REPO),
        )
