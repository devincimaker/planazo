---
name: merge
description: Land a PR and prove nothing was left open — gate it, merge from inside its worktree so the reap hook fires, watch the production migration deploy, close the Linear issue, then verify each of those actually happened. Use when the user runs /merge or /merge 54, or asks to merge, land or ship the PR they have been working on.
argument-hint: "[PR number]"
---

# /merge — land the PR, then prove the work is actually closed

The merge is one command. Everything that gets forgotten happens after it: a
simulator still booted, a branch database still billing, a production migration
that never deployed, a Linear issue still reading In Progress. Two worktrees and
two issues were left in exactly that state before this skill existed.

**This skill ends at a verified closed list, not at a successful merge.** A merge
that returned zero proves nothing on its own.

## Ground rules

- **Merge from inside the worktree.** A PostToolUse hook on `gh pr merge`
  (`.claude/settings.json` → `scripts/worktree-reap.sh`) reclaims *the worktree
  the merge command ran in*. Run `gh pr merge 54` from main and it exits early by
  design: worktree, simulator and branch DB all survive, and nothing warns you.
  If this session is standing in main and the PR belongs to a worktree, `cd` into
  that worktree first, or hand the merge to the session that owns it.
- **A browser merge skips the hook entirely.** It only fires on the Bash tool
  call. When you arrive at a PR that is already `MERGED`, skip Phase 3 and do the
  reclaim by hand (Phase 6 covers it).
- **The gate runs before the merge, not after.** Half of what makes the reclaim
  fail — a dirty tree, an unpushed commit — is free to see beforehand and
  annoying to unpick afterwards.
- **Never merge a red or pending check**, and never push migrations to production
  by hand. The `deploy` job owns that, and it runs *after* the merge.
- **Narrate each phase in one line**, so the decisions stay challengeable:
  `[#54 · gate] CI green · tree clean · See it working present · PLA-69 In Review`

## Phase 1 — Identify what is being merged

1. **With an argument**: `gh pr view <n> --json number,title,state,headRefName,body,url`.
   **Without one**: the same call with no number resolves the PR for the current
   branch. If neither works, ask — never guess from `pnpm wt:list`.
2. Derive the issue from the branch name (`fix/pla-69-...` → `PLA-69`), then
   `mcp__linear__get_issue` to confirm it exists and read its current status.
3. Locate the worktree: `pnpm wt:list`, matching on branch. Read its
   `.env.worktree` for the DB mode — a `branch` DB is the piece that costs money
   if the reclaim silently fails.
4. Report in one line: PR, branch, worktree path, DB mode, issue and its status.
   This is the cheap moment to catch "wrong PR".

## Phase 2 — The gate

Every row is a stop, not a warning. Report the whole table, then stop on the
first failure and say what would fix it.

| Check | How | Stop when |
| --- | --- | --- |
| PR is open and mergeable | `gh pr view --json state,isDraft,mergeable,mergeStateStatus` | draft, `CONFLICTING`, or already `MERGED` (→ Phase 6 instead) |
| Every check passed | `gh pr view --json statusCheckRollup` | anything not `SUCCESS`, including still-running. Pending is a wait, not a pass |
| Nothing uncommitted | `git status --short` in the worktree | any output — `wt:rm` refuses a dirty tree, so the reclaim would fail *after* the merge |
| Nothing unpushed | `git log @{u}.. --oneline` | any commit — you are about to merge without your last change |
| `## See it working` | the PR body from Phase 1 | missing on a user-visible change (AGENTS.md requires it). Say so; the user decides whether to add it or wave it through |
| Issue is real and open | Phase 1's `get_issue` | already `Done` (someone closed it early — confirm this is the right issue) |

## Phase 3 — Merge

From **inside the worktree**:

```bash
gh pr merge <n> --squash --delete-branch
```

`--squash` because history here is one commit per PR, ending `(PLA-NN) (#NN)`.
`gh` may report it could not delete the local branch while the worktree still has
it checked out — harmless, the reclaim removes both a moment later.

Then **read the hook's message before doing anything else.** It reports one of:

- reclaimed the worktree, simulator and branch DB — and, if main gained
  migrations, that it pulled main and applied them locally;
- kept the worktree because the PR is not `MERGED`;
- could not reclaim, with `wt:rm`'s reason (a dirty tree, most often).

The last two are yours to finish. The hook never retries itself.

## Phase 4 — Watch what the merge started

Merging pushes to main, which starts CI again. When the PR touched
`supabase/migrations/`, the `deploy` job pushes those migrations to production
after the tests pass.

**This is the only step whose failure is both silent and expensive**: production
schema drifts from main, and the next thing to notice is a feature failing for
real users. Nothing else in the flow watches it.

```bash
gh run list --branch main --limit 1        # find the run the merge created
gh run watch <id> --exit-status            # or poll if you would rather not block
```

Report the verdict. A failed `deploy` is not "the merge worked, but" — it is an
open incident, and it goes at the top of the Phase 6 report.

If the PR touched no migrations, say so and skip: `deploy` is a no-op and waiting
on it is dead time.

## Phase 5 — Close the Linear issue

`mcp__linear__save_issue` with `state` **Done**
(`bb97b98d-af58-41e2-887b-cf4e60543009`). Re-resolve with
`list_issue_statuses` on team `Planazo` rather than trusting that id if the call
fails.

Do this **after** Phase 4, not before. An issue marked Done while its migration
failed to deploy is a false record, and the board is the thing you will trust
later.

## Phase 6 — Prove it

Print the closing list, each line carrying its evidence. Anything you could not
check is listed as **not verified** — never assumed.

| Closed | Evidence |
| --- | --- |
| PR merged, remote branch gone | `gh pr view <n> --json state,headRefName` |
| Worktree, simulator, branch DB reclaimed | `pnpm wt:list` no longer lists the branch |
| main has the squash commit | `git log --oneline -1` from the primary checkout |
| Local migrations applied | the hook said so, or `supabase migration up --local` |
| CI on main green, `deploy` included | Phase 4's run |
| Issue is Done | Phase 5's response |

Two follow-ups belong here and nowhere else:

- **A refused reclaim.** Fix the reason (usually commit or stash), then
  `pnpm wt:rm <branch>` from the primary checkout. A `branch`-mode DB bills until
  that runs.
- **Other worktrees flagged `MERGED`.** Report them, do not reclaim
  them. They belong to other sessions that may still be working, and touching
  another worktree's simulator or branch DB is the one rule the whole `wt:*`
  family is built on. Ask first, every time.

## When something goes wrong

| Symptom | What it means | Do this |
| --- | --- | --- |
| Hook said nothing at all | the merge did not run from a worktree (main, or the wrong one) | reclaim by hand: `pnpm wt:rm <branch>` from the primary checkout |
| "Worktree kept: the PR for '<branch>' is OPEN" | `gh pr merge <n>` merged a *different* PR than this worktree's branch | merge this branch's PR from this worktree, or reclaim by hand |
| "Could not reclaim … dirty tree" | uncommitted work in the worktree | commit or stash it, then `pnpm wt:rm <branch>` |
| PR already `MERGED` on arrival | merged in the browser, so no hook fired | skip Phase 3; run Phases 4 to 6, reclaiming by hand |
| `mergeStateStatus: BLOCKED` | a required check or review is missing | fix the check. Never `--admin` past it |
| `deploy` job failed | migrations did not reach production | read the run log; fix forward with a new migration. Never `db push` to production by hand |
| Migration failed locally after the pull | main's new migrations did not apply here | `supabase migration up --local` from the primary checkout |
| Anything database-shaped, or a `wt:*` refusal | a guard fired | invoke the **`wt`** skill; it has every refusal and its remedy. Do not work around one |
