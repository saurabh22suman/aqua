# Branch protection on `main` — what's live, and the one gap left

Protection on `main` is **applied and enforcing**. It is implemented as a
repository **ruleset**, not as a classic branch protection rule — which
matters mostly because the two are reported by different API endpoints
and configured in different corners of the GitHub UI.

The reason this document still exists is the one setting that was
deliberately left open: **`required_approving_review_count: 0`**. See
"The open gap" below. `CLAUDE.md` names this file as the runbook for
exactly that.

## What is configured

Ruleset **`main protection`** (id `22285086`), created 2026-09-04,
`enforcement: active`, targeting `~DEFAULT_BRANCH`:

| Rule | Setting |
|---|---|
| `deletion` | on — `main` cannot be deleted |
| `non_fast_forward` | on — no force pushes |
| `pull_request` | required; `required_approving_review_count: 0`; `require_last_push_approval: false`; merge, squash and rebase all allowed |
| `required_status_checks` | `ci` and `agent-protected-paths`, with `strict_required_status_checks_policy: true` (branch must be up to date with `main` before merging) |
| `bypass_actors` | `[]` — empty. Nobody bypasses this, including the repo owner (`current_user_can_bypass: "never"`). |

There is nothing to click here — it is already applied. If it ever needs
changing, it lives under **Settings → Rules → Rulesets**, not Settings →
Branches.

## Verify it

```
gh api repos/saurabh22suman/aqua/rulesets
```

Expected output today:

```json
[
  {
    "id": 22285086,
    "name": "main protection",
    "target": "branch",
    "source_type": "Repository",
    "source": "saurabh22suman/aqua",
    "enforcement": "active",
    "created_at": "2026-09-04T21:51:05.758+05:30",
    "updated_at": "2026-09-05T02:41:52.016+05:30"
  }
]
```

For the rules themselves, fetch the ruleset by id:

```
gh api repos/saurabh22suman/aqua/rulesets/22285086 --jq '{
  enforcement,
  bypass_actors,
  rules: [.rules[] | {type, parameters}]
}'
```

**Do not** use `gh api repos/saurabh22suman/aqua/branches/main/protection`
to check this. That endpoint reports *classic* branch protection only,
and returns `{"message":"Branch not protected","status":"404"}` for this
repo — a 404 there means "no classic rule exists", not "main is
unprotected". An earlier version of this document told the reader to run
exactly that command and expect to see `"ci"`, which would read as a
failure every single time.

End-to-end evidence, not just config: PR #118 (merged 2026-09-10) ran
`ci` as a check on the pull request itself and could not be merged until
it passed.

## The open gap: zero required approvals

`required_approving_review_count` is `0`. A PR can be opened and merged
by the same person with no second pair of eyes, provided CI is green.
**Green CI is therefore the only mechanical guard on what reaches
`main`.**

This was a deliberate call: this is a solo repo right now, and requiring
your own approval on your own PR buys nothing but a click. **Raise it to
`1` the day a second person can review.** That is the trigger — a second
reviewer existing, not a date.

Until then, the compensating control is the **F1 self-merge suspension**
(`CLAUDE.md` → Git workflow, and `docs/five-day-work-guide.md`
§"Self-merge suspension"): agents do not merge their own PRs; every merge
comes to the human. The previous version of that rule was
memory-dependent and failed 3 for 3 in the audit window, which is why the
mechanical replacement exists —
`.github/workflows/agent-protected-paths.yml` plus its companion test
`tests/tier1/agent-protected-paths.test.ts`. Any PR touching
`db/migrations/**`, `lib/auth/**`, `lib/money/**`, or consent-related
paths needs the `human-approved-merge` label, and the agent's token
cannot apply it. That check is one of the two required contexts above, so
it is enforced by the same ruleset.

Note this is a *compensating* control, not a substitute: it constrains
who merges and which paths need a human, but it does not produce a code
review. Treat the zero-approval limit as absolute regardless of how
convenient a self-merge would be.

## Historical: how this looked before the ruleset

Checked 2026-08-28, **before the ruleset existed** — retained only to
show what the problem was, not as a description of current state:

```
$ gh api repos/saurabh22suman/aqua/branches/main/protection
{"message":"Branch not protected", ...}

$ gh run list --limit 5
CI · success · push · main
```

At that point every run had been triggered by a direct push to `main`
rather than a PR. `ci.yml` declared `on: pull_request`, but a trigger is
not a gate — CI only ever told us `main` was broken *after* it was
already broken on the branch everything ships from. The ruleset above is
what closed that.

## What this does not do

This does not run CI *before* the deploy pipeline decides to deploy — it
only stops broken code from reaching `main` in the first place. D5
(deploy pipeline) still needs to gate the actual deploy trigger on a
green run, not just on a push event, even though pushes to `main` will
now only ever be green merges. Belt and suspenders: this ruleset is the
belt.
