# Branch protection — settings to apply to `main`

**Who does this:** you, in the GitHub UI. An agent cannot change repository
settings — this document exists so the click-path doesn't have to be
re-derived.

**Why this exists:** the CI workflow (`.github/workflows/ci.yml`) already
declares `on: pull_request`, but a trigger is not a gate. Checked
2026-08-28 against this repo directly:

```
$ gh api repos/saurabh22suman/aqua/branches/main/protection
{"message":"Branch not protected", ...}

$ gh run list --limit 5
CI · success · push · main
```

Every run so far was triggered by a direct push to `main`, not a PR — the
convention has been push-to-main, and CI has only ever told us main was
broken *after* it was already broken on the branch everything ships from.
No branch protection rule exists to stop that. This document is the fix.

## Prerequisite: get one PR-triggered run to exist

GitHub can only offer a status check as a required check once it has run
at least once in this repo. Before doing the steps below, open any small
PR (a doc typo fix is enough) so `ci` shows up as a check on a pull
request. Once it runs and shows up, come back and finish this setup —
you can delete the throwaway PR/branch afterward.

## Steps

1. Go to **Settings → Branches** (`https://github.com/saurabh22suman/aqua/settings/branches`).
2. Under **Branch protection rules**, click **Add branch protection rule**
   (or **Add rule** — GitHub renames this button periodically).
3. **Branch name pattern:** `main`
4. Check **Require a pull request before merging**.
   - **Required number of approvals before merging:** `0`. This is a
     solo repo right now — requiring your own approval on your own PR
     buys nothing. Raise this to `1` the day a second person can review.
   - Leave "Dismiss stale pull request approvals" off for now (no
     reviewers yet, nothing to dismiss).
5. Check **Require status checks to pass before merging**.
   - Check **Require branches to be up to date before merging**.
   - In the search box, find and select the check named **`ci`** (the
     job id in `ci.yml` — it will not appear in the list until step 0's
     prerequisite PR has run at least once).
6. Check **Do not allow bypassing the above settings**. This is the
   setting that used to be called "Include administrators" — it is what
   makes "no bypass for admins" actually true, including for you.
7. Leave **Allow force pushes** unchecked and **Allow deletions**
   unchecked (both default off — just confirm they're still off).
8. Click **Create** (or **Save changes**).

## Verify it worked

```
gh api repos/saurabh22suman/aqua/branches/main/protection --jq '{
  required_status_checks: .required_status_checks.contexts,
  enforce_admins: .enforce_admins.enabled,
  require_pr: .required_pull_request_reviews != null
}'
```

Expect `required_status_checks` to include `"ci"`, `enforce_admins` to be
`true`, and `require_pr` to be `true`. Also confirm directly: try
`git push origin main` with a trivial local commit — it should be
rejected once this is live (push protected branches only accept merges
through a PR).

## What this does not do

This does not run CI *before* the deploy pipeline decides to deploy — it
only stops broken code from reaching `main` in the first place. D5
(deploy pipeline) still needs to gate the actual deploy trigger on a
green run, not just on a push event, even though pushes to `main` will
now only ever be green merges. Belt and suspenders: this document is the
belt.
