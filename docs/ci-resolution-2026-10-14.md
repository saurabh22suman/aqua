# CI follow-up — PR #196

The owner explicitly authorised maintenance of the seven previously failing
`tests/tier1/**` files and updated the local agent instructions. This follow-up
changes tests and fixtures, not production permissions or the CI gates.

## Corrections

- Catalogue and tenant-creation pins include `levels.write` and the seventh
  `curriculum_lead` role. The independent exact permission matrix is retained:
  owner/admin cannot mark attendance, ordinary coaches cannot edit curriculum,
  curriculum leads cannot manage settings, and workers have self-service only.
- Surface tests now allow the worker surface and explicitly deny worker access
  to the parent/owner/coach/reception surfaces. Curriculum leads use the coach
  surface and are denied management surfaces. Feature-off denial remains tested.
- Ops authentication tests exercise real challenge/session/audit persistence
  through the current WhatsApp OTP route. Only external message delivery and
  Next request transport are mocked. Coverage includes wrong, expired and
  replayed codes, origin/host validation, account suspension, viewer denial,
  logout revocation, and rejection of legacy password/TOTP entry points.
- Historical attendance enrolment uses a fixed date preceding both sessions,
  and asserts successful enrolment before marking. Period/isolation assertions
  remain intact; no system clock changes or eligibility relaxation.
- The owner UI Testcontainer fixture drains the application pool before stopping
  Postgres. Previously all assertions passed but an unhandled `57P01` teardown
  error still caused a shard process to exit non-zero. The error is fixed rather
  than ignored, and the runner remains strict about process exit codes.

## Verification

Dedicated disposable Postgres 16 at port 55441; no shared database reset.

- `pnpm typecheck` and `pnpm lint`: pass.
- Seven formerly failing files: pass (143 assertions across the focused run,
  with the final Ops route assertion rerun successfully).
- Final `pnpm test:sharded`: **367/367 files; 2,813 passed, zero failed,
  one skipped; zero failing files**, successful exit.
- `pnpm build`: pass.

The historical red-suite records in the remediation ledgers remain as evidence
of their original runs; their outstanding test-pin blockers are superseded by
this follow-up. Remote CI must still pass on the pushed commit before the PR
can be described as green.

## Still open

The Owner/Admin `levels.write` backfill policy question is unchanged. These
tests pin the current implementation while that product decision is pending;
they do not settle it. Prompt 3 remains an isolated design preview, with
production redesign integration pending. The PR stays draft; no merge or
deployment is authorised by this verification.
