---
name: hunt
description: Hunt for exactly one improvable thing in the codebase — a real bug, or one piece of code that should be cleaner, extracted, or more testable — qualify it, and report it. On approval, file it as a Linear issue and hand off to /start. Use when the user runs /hunt, optionally with an area to search (/hunt apps/mobile).
argument-hint: "[path, area, or lens to hunt with]"
---

# /hunt — find one thing worth fixing, then wait

One hunt produces **one finding**, reported well enough that the user can decide
in a minute whether it deserves a worktree. The skill ends twice: first at the
report (waiting for a verdict), then — only on approval — at a filed Linear
issue handed to `/start`.

## Ground rules

- **One finding.** Not a list, not an audit. If the hunt surfaces several
  candidates, pick the best and mention the runners-up in one line each so a
  future `/hunt` can pick them up. Ranking beats volume: a hunt that returns
  five half-qualified items pushes the qualification work onto the user.
- **Read-only.** A hunt never edits code, never fixes the thing it found, and
  never creates the worktree. Finding and fixing are separate decisions, and
  the second one is the user's.
- **Report, then stop.** The report is the end of the turn. No Linear issue,
  no `/start`, nothing, until the user says go. If the verdict is "skip",
  the hunt is over — do not argue for the finding or offer to file it anyway.
- **New findings only.** Known debt does not count: anything already in Linear,
  the `eslint-disable max-lines` files (they point at their own PLA issues),
  the unused-export backlog PLA-64 is clearing, and knip exclusions with
  reasons. A hunt that rediscovers the backlog wastes the whole exercise —
  dedup before reporting, not after.

## Phase 1 — Pick the ground

If the user passed an area (`/hunt apps/mobile`, `/hunt the block logic`),
hunt there. The argument can also be a **lens** rather than a place — `/hunt
tests that assert nothing`, `/hunt UI redundancy` — in which case sweep the
codebase for that kind of finding and let the lens replace the list below.
Otherwise pick your own ground and say which in one line. Good
grounds, in rough order of yield:

- **Recently churned code**: `git log --oneline -20` and the files the last few
  PRs touched. Fresh code has fresh bugs, and review pressure was on the diff,
  not its surroundings.
- **Logic living where it can't be tested**: branches inside components, math
  inline in RPC call sites, anything a jest test can only reach by standing up
  the world. The repo's own rule (one function, one purpose; logic extracts to
  `packages/shared` or a screen's `lib/`) is the cleanup template.
- **Edges the tests skip**: a suite that covers one happy path around code
  with real branching (empty, zero, boundary, unexpected order).
- **Seams**: places where two features meet (blocks × plans, invites ×
  friendships, timezone × month grid) — cross-feature rules like the shield
  rule in AGENTS.md are where consistency bugs live.

Use an Explore agent for the broad sweep if the ground is wide; read the
finalists yourself. The finding must come from code you have actually read,
not from an agent's summary.

## Phase 2 — Qualify it

A candidate becomes a finding only if it survives this:

- **A bug needs a failure scenario.** Concrete inputs or state → wrong
  behavior a user or the data can hit. "This looks suspicious" is not a
  finding; trace the actual path. Check the tests: if a test pins the behavior
  you think is wrong, either the test documents intent (not a bug) or the test
  itself is the finding.
- **A cleanup needs a payoff in this repo's terms.** Name it: logic becomes
  unit-testable by extraction, a function stops needing "and" in its honest
  name, duplicated math gets one owner, a file heads back under the 400-line
  cap. "Could be more elegant" is taste, not a finding.
- **It must be new.** Search Linear (`list_issues`, team Planazo, including
  Backlog/Todo) for the file or feature before reporting. Check the file's
  head for an `eslint-disable ... -- PLA-XX` pointer. If it's tracked, go back
  to Phase 1 — do not report a duplicate with better wording.
- **Size it honestly.** Most hunt findings should be `S`. If qualification
  reveals an `L`, it may still be worth filing, but say so — the user is
  approving hours, not a quick win.

## Phase 3 — Report and stop

The report, in this shape:

1. **The claim, one sentence**, with `file.ts:line`. Bug or cleanup, stated
   plainly.
2. **The evidence.** For a bug: the failure scenario, step by step. For a
   cleanup: what it looks like today and what the payoff is (name the tests
   that become writable, the rule it starts obeying).
3. **The proposed fix, two or three sentences.** Enough to size it, not a
   design doc.
4. **The routing guess**, in `/start`'s terms: size label, shared vs `--db`,
   simulator or not. `/start` re-decides this from the issue; the guess is so
   the user knows what approving costs.
5. **Draft issue title**, imperative, matching the existing convention.
6. **Runners-up**, one line each, unqualified, if any.

Then stop. The user's reply decides what happens next — and a question about
the finding ("would that also affect X?") is a question, not approval.

## Phase 4 — On approval only: file it, then /start

1. **Create the issue** with `mcp__linear__save_issue`, team `Planazo`, state
   **Todo**. Labels: `Bug` or `Improvement`, plus a size (`S`
   `7393c40e-fe85-4864-b834-e13e0d073128`, `M`
   `139c043b-ff29-4701-a541-aaa9148517c9` — re-resolve via
   `list_issue_labels` if a call fails).
2. **Write the body so `/start` can consume it without this conversation.**
   What's wrong and where (exact paths and lines), the failure scenario or
   payoff, and — when the approach is already clear — a `Work` section naming
   the change, so `/start` knows there is nothing left to plan. Fold in
   anything the user's approval message adjusted.
3. **Hand off**: invoke the **start** skill with the new identifier. Setup,
   routing, and the worktree are its job — do not duplicate them here. If the
   user approved the issue but said "not now", file it, report the identifier,
   and end without `/start`.
