---
description: Review a GitHub PR with the smart-review skill and post the findings as PR comments.
argument-hint: "[PR number or URL]"
---

Review PR `$ARGUMENTS` with the **smart-review** skill and publish the result back to GitHub. Requires `gh` authenticated for this repo.

1. Resolve the PR: `gh pr view $ARGUMENTS --json number,baseRefName,headRefName,url` to confirm it exists and get its base branch.
2. Fetch the diff without checking out or moving the user's HEAD: `gh pr diff $ARGUMENTS`. Use this as the diff for Step 1 of the skill (skip the local `git diff` capture — you already have the diff content).
3. Run the skill's Routing to pick `min` vs `max`, then that workflow, per SKILL.md. Look for a spec (Step 2) same as usual — PR description/linked issue counts as the spec if present.
4. **Human gate — do not post anything yet.** Show the full report (SKILL.md's "Report format") in chat and ask the user what to publish before touching GitHub:
   - Post everything, as-is.
   - Post P0/P1 only (drop P2/P3 nits from what goes to GitHub).
   - Post a user-picked subset (they name findings to include/exclude).
   - Don't post at all — this was a dry run.
   Wait for an explicit answer. Never post on the assumption that running the command implied consent to publish; running the review and publishing it are two separate approvals.
5. Once the user confirms a scope, post only that scope:
   - One summary comment with the confirmed findings, same report format: `gh pr comment $ARGUMENTS --body-file <tmpfile>`.
   - For each confirmed P0/P1 finding with a resolvable `file:line`, also post an inline review comment: `gh api repos/{owner}/{repo}/pulls/$ARGUMENTS/comments -f body="..." -f commit_id="<head sha>" -f path="<file>" -F line=<line_end>` (get owner/repo/head sha from step 1's `gh pr view` output, extended with `headRefOid`). Never post inline comments for findings the user excluded. A P0 tagged `unproven` is not an inline blocking comment unless the user explicitly included that finding.
6. Do not approve, request changes, or merge the PR — this posts comments only. State the verdict in your final reply but leave the actual PR review decision to a human.

This is the same lenses and merge contract as `/smart-review:review`/`min`/`max` — this command only adds the GitHub fetch/post glue, not a new review logic path.
