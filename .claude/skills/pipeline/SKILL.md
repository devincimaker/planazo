---
name: pipeline
description: Run a Linear issue through the full dev pipeline — worktree, planned + Sol-reviewed implementation by a difficulty-routed Claude model, iterative fresh-context Sol code review with a findings ledger, CI, auto-merge or human escalation. Use when the user runs /pipeline PLA-XX or asks to pipeline an issue.
argument-hint: PLA-XX
---

# /pipeline — Linear issue to merged PR

You are the **orchestrator**. You never write feature code yourself. One **dev agent** (a Claude subagent whose model you pick in Phase 0) does all development and keeps its session for the whole run; **Sol** (Codex CLI, via `scripts/review.sh`) reviews with a *fresh context every round*, continuity provided only by the findings ledger. You triage, route, log, and decide.

**Paths.** `SKILL_DIR` = this skill's directory in the main checkout (worktrees don't have it). `WT` = absolute path of the worktree. Run all git/pnpm/gh/review commands with cwd `WT`; run `wt:new`/`wt:rm` from the main checkout. All state lives in `WT/.pipeline/` (auto-git-excluded by review.sh).

**Logging — required.** Before every step, print one narration line so the user can follow which model is doing what:
`[PLA-20 · setup] worktree fix/pla-20-cap (shared) · dev model: opus — UI-only issue`
`[PLA-20 · plan] sol (medium): 1 high, 2 low → opus revising plan`
`[PLA-20 · R1/4] sol (xhigh): 2 high, 3 low deferred → opus fixing`
`[PLA-20 · R2/4] sol (medium): approve → waiting on CI → merging`
Also post each round's summary as a PR comment (see Phase 3) — that's the persistent log when several pipelines run at once.

**Concurrency.** One /pipeline per Claude session. For parallel issues, open more sessions in the main checkout — worktree tooling isolates ports, simulators, and databases.

## Phase 0 — Setup & routing

1. Read the issue with the Linear MCP (`get_issue`); resolve the team's status names once (`list_issue_statuses`) — you need the started ("In Progress"), review-type, and completed ("Done") states. Move the issue to In Progress.
2. Write `.pipeline/issue.md` (after step 4 creates the worktree): identifier, title, full description, labels, acceptance criteria, issue URL.
3. Route two independent choices, and log both with one-line reasons:
   - **DB mode** — per AGENTS.md: `--db` iff the issue implies schema change; shared otherwise; shared when ambiguous.
   - **Dev model** — `fable` if the issue touches migrations/RLS/RPCs/triggers, auth or security-sensitive paths, concurrency/races, or cross-cutting refactors; `opus` for UI, copy, styling, navigation, state, tests, config. Rationale: the right model from the first draft beats escalating mid-loop; a saved review round pays the difference.
4. From the main checkout: `pnpm wt:new <branch> [--db]`, branch named `fix|feat/pla-XX-<slug>` per repo convention.
5. Spawn the **dev agent**: Agent tool, `subagent_type: general-purpose`, `model:` as routed, `run_in_background: false`. Its prompt must include: the absolute `WT` path (work only there), "follow AGENTS.md — read `.env.worktree` and `apps/mobile/.env` first", the contents of `.pipeline/issue.md`, and this phase instruction: *"Research the codebase and return an implementation plan only — files to touch, approach, migration/RLS details if any, and a test plan. Do not write code yet."* Continue this same agent later with SendMessage (load its schema via ToolSearch when first needed) — it must keep its context across all fix rounds.

## Phase 1 — Plan review (one round, cheap)

1. Save the returned plan to `.pipeline/plan.md`.
2. `bash $SKILL_DIR/scripts/review.sh --mode plan --plan-file .pipeline/plan.md` (cwd `WT`). Read the findings JSON it prints.
3. High findings → SendMessage them verbatim to the dev agent: revise the plan. Save the revision over `plan.md`. Do **not** re-review — plan review runs once; it exists to catch wrong-thing-built, not to gold-plate.
4. SendMessage: *"Plan approved. Implement it. Then run the gates — `pnpm turbo typecheck lint test` and `pnpm test:integration` — and fix until green (the suite's refusal messages contain the fix; `pnpm wt:setup --db` if you discover you need schema after all). Commit referencing PLA-XX, push -u, open the PR with `gh pr create --base main` (body: what/why + link to the issue), and return the PR number plus a summary of what you built."*

## Phase 2 — Gates & PR

The dev agent runs the deterministic gates itself (Phase 1 step 4). When it returns the PR number, verify the PR exists (`gh pr view <n>`). Initialize `.pipeline/ledger.json`:

```json
{ "issue": "PLA-XX", "pr": 0, "dev_model": "opus", "rounds": [], "findings": [] }
```

Finding statuses: `open` → `fixed-claimed` (dev says fixed) → `fixed-verified` (Sol confirms) | `still_present` (reappeared); `deferred` (low, parked).

## Phase 3 — Review loop (rounds 1–4)

For round N:

1. `bash $SKILL_DIR/scripts/review.sh --mode code --round N --base main` (cwd `WT`). Round 1 runs Sol at xhigh (broad hunt); later rounds at medium (verify fixes + scan the delta). Read the findings JSON.
2. **Triage.** New `high` findings → open, must fix. New `low` findings → `deferred`; they never trigger a round. `prior_findings_check`: `fixed` → `fixed-verified`; `still_present` → mark it so. Update the ledger (append to `rounds`: round, effort, new_high, new_low, verdict).
3. **Post the round summary as a PR comment** (`gh pr comment`): reviewer + effort, verdict, table of new findings (id, severity, title, scenario), prior-findings check results, and what happens next.
4. **Decide, in this order:**
   - Any `still_present` → **STOP: needs-human** (a fix that didn't take means more rounds churn).
   - Round ≥ 2 and `new_high(N) >= new_high(N-1) > 0` → **STOP: needs-human** (not converging — likely mis-designed, review can't fix design).
   - Verdict `approve` and no open high → **success path** (Phase 4).
   - N = 4 with open highs → **STOP: needs-human**.
   - Otherwise → fix round: SendMessage the open high findings verbatim (id, scenario, files, fix_hint) to the dev agent: *"Fix exactly these, rerun the gates, push."* Mark them `fixed-claimed`. Next round.

## Phase 4 — Terminal states

**Success:** wait for CI — `gh pr checks <n> --watch`. If CI fails, SendMessage the failure to the dev agent to fix and push; that consumes the next review round number (re-review at medium before merging, the diff changed). When green: `gh pr merge <n> --squash --delete-branch` (if it conflicts because another pipeline merged first: dev agent rebases on origin/main, reruns gates, pushes, then merge). Then:
- Linear: comment a run summary — rounds used, models (dev model, reviewer efforts), findings fixed, and the list of `deferred` findings as follow-ups the user can promote to issues. Move to Done.
- From the main checkout: `pnpm wt:rm <slug>`. If migrations merged, remind the user: main needs `git pull` + `supabase migration up` (CI already deployed prod).
- Final narration line: outcome, rounds, deferred count.

**Needs-human:** post the same summary + *why the loop stopped* (which rule fired) to Linear and the PR; move the issue to the review-type status; leave the worktree and PR untouched for the human. Final narration line says exactly where to pick up.
