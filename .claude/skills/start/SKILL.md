---
name: start
description: Start work on a Linear issue — mark it In Progress, create and initialize the right worktree (shared vs --db, simulator only when the issue is user-visible), enter it, then plan the change together before any code is written. Use when the user runs /start PLA-XX, or asks to start working on an issue or open a PR for one.
argument-hint: PLA-XX
---

# /start — Linear issue to a worktree you're already inside, then a plan

The boring parts happen before the conversation does. By the time you and the user
are discussing what to build, the issue is In Progress, the worktree exists with the
right database, and this session is inside it.

**This skill ends at an agreed plan.** You then implement in normal conversation, with
the user reviewing as you go.

## Ground rules

- **Setup runs first, and you do not ask permission for it.** Reading the issue, moving
  it to In Progress and creating the worktree are the reason the skill was invoked, not
  decisions to confirm. Never open with "shall I create the worktree?".
- **No feature code before the plan is agreed.** Reading code while planning is the job;
  editing it is not.
- **Plan mode active at invocation?** Setup writes to Linear and to disk, so it is
  blocked. Say so in one line and ask the user to leave plan mode. Do not skip setup and
  plan against a worktree that does not exist.
- **Narrate each step in one line**, so the routing decisions are visible and easy to
  challenge:
  `[PLA-49 · setup] fix/pla-49-founder-invite-code · --db (RLS policy change) · no simulator (nothing on screen)`
- The slow step is `--db` provisioning (minutes). Fire it, then read code while it runs.
  Overlapping the wait with the research is the point of doing setup first.

## Phase 1 — The issue

1. `mcp__linear__get_issue` on the identifier. Never route from the issue number alone.
2. Resolve statuses once (`list_issue_statuses`, team `Planazo`) and move the issue to
   **In Progress** with `save_issue`. In Progress is
   `85d34886-2747-4165-8662-9b8c8eb568b1`; re-resolve rather than trusting that id if the
   call fails. Do this **before** the slow steps, so the board is honest the moment work
   starts.
3. Print a 3 to 5 line brief: title, labels and size, what the issue says is broken, what
   it suggests. This is the last cheap moment to catch "wrong issue".

## Phase 2 — Route: two independent calls, each logged with its reason

| Call | Choose the expensive option when | Ambiguous → |
| --- | --- | --- |
| **Database** | the work implies schema: migrations, RLS or policies, RPCs, triggers, new tables/columns/indexes, `SECURITY DEFINER` → `--db` | **shared**. `pnpm wt:setup --db` upgrades in place the moment you find you need it |
| **Simulator** | the issue changes something on screen: UI, copy, navigation, styling, state, loading and error states → build one (the default) | **`--no-sim`**. `pnpm wt:setup --sim` builds one the moment the diff says you need it |

`--no-sim` is the half that actually saves time: without it, setup creates, boots and
installs a Dev Client no matter what this table decided, and the choice only governed
whether `wt:start` ran afterwards.

The same cheap-to-upgrade logic on both sides: a wrong "shared" or a skipped simulator
costs one command, a wrong `--db` costs money and minutes. See the **`wt`** skill for the
full database decision and every guard refusal it can produce.

## Phase 3 — The worktree

1. **`pnpm wt:list` first.** If a worktree for this issue already exists, enter it and
   skip creation. Running `/start PLA-49` twice must resume, not fail. A worktree you did
   not create may belong to another session: ask before touching it.
2. From the main checkout: `pnpm wt:new fix|feat/pla-XX-<short-slug> [--db]`. Branch names
   follow the AGENTS.md convention, not Linear's `gitBranchName`. Use a **Bash timeout of
   600000** — branch-database provisioning takes minutes and a default timeout will kill
   it midway.
3. If setup dies partway it prints the exact retry (`pnpm wt:setup <target> [--db]`). Run
   that. Do not delete the worktree and start over.
4. **Enter it**: `EnterWorktree` with `path: ../planazo-worktrees/<slug>` — legal because
   the path is in `git worktree list`. If it refuses, stay in the main checkout and run
   every subsequent command with the worktree's absolute path as cwd.
5. Read `.env.worktree` and `apps/mobile/.env` (AGENTS.md requires this) and report the
   slot in one line: Metro port, simulator name, DB mode, and which database URL is live.
   Never assume main's.

## Phase 4 — Simulator, only if Phase 2 said so

`pnpm wt:start`, plus `--login` when the change needs a signed-in user, which is most of
them. It backgrounds Metro itself and returns, so run it in the foreground with a
generous timeout.

**Never pipe it through `tail` or `head`.** They print nothing until EOF, and the Metro
spawn holds the pipe open, so the command looks hung when it finished a minute ago. PLA-73
lost twenty minutes to `pnpm wt:start --login 2>&1 | tail -25`: a 600s block, an empty
output file, and a session convinced it was waiting on something already done. Let it
stream, or redirect to a file and Read that.

**Confirm readiness with a probe, not with the command's exit.** These two answer it
outright, and they are cheap enough to run whenever there is any doubt:

```bash
lsof -ti :$PLANAZO_METRO_PORT          # Metro is listening
xcrun simctl list devices booted       # and this worktree's simulator is up
```

Be careful reading `ps` here: every other worktree runs its own `worktree-start.sh` and
`expo start`, so a match proves someone's Metro is alive, not yours. Match on the port.

It refuses loudly in two cases that are the guard working, not a problem to route around:
a shared-mode worktree carrying migrations (fix: `pnpm wt:setup --db`), and a port held by
another project's bundler (fix: `pnpm wt:setup` for a new port — never kill the other
bundler).

**To reach a screen, deep-link to it.** The app's scheme is `planazo`, and expo-router maps
routes straight onto it:

```bash
xcrun simctl openurl "$UDID" "planazo://profile"
xcrun simctl openurl "$UDID" "planazo://plan/<id>/poll"
```

Chains of blind taps drift, and a fast refresh resets navigation to the feed underneath
you, so a chain that worked once fails silently the next time. For anything a deep link
cannot reach, invoke the **`simulator-driving`** skill rather than improvising taps.

**Let the tests carry the numbers.** The simulator answers "does this look broken", which
is one screenshot. It is a slow and imprecise way to assert a padding value that a unit
test can pin exactly.

## Phase 5 — Plan it together

This is what the skill is actually for. The setup was just clearing the runway.

**First, check whether there is anything left to plan.** When the issue carries a `Work`
section that already names the change, and the label is `S`, the plan has been written —
by whoever filed it. Read the code, do it, and report what you found and what you decided
in the summary afterwards. Planning it a second time is the expensive way to agree with
the issue.

PLA-73 said "extract the bar once and have the five call it". Restating that as findings,
levers and two blocking questions cost twenty-five minutes on a change that took fifteen.
The one genuine discovery — that the padding differences were a home-indicator bug, not
drift — was worth a sentence in the summary, not a gate in front of the work.

So: **plan when the issue leaves the approach open, implement when it does not.** The
rest of this phase is for the first case.

1. **Read the code the issue names before proposing anything**, and report which of the
   issue's claims the code confirms and which it does not. Issues here often carry
   archaeology in their descriptions; the migration that supposedly made something
   vestigial is worth opening.
2. **Present, in this order:** what you found → the levers available → a recommended
   approach → the open questions. Two rules govern the levers:
   - **Copy and content are levers, not fixed constraints.** Pick the cheapest lever that
     solves the *class* of problem, and say why you rejected the cheaper ones. If a label
     does not fit, "shorten the label" ranks alongside "change the layout". Propose exact
     wording, never a vague "shorten it", and flag any user-facing copy change as needing
     sign-off. (Product copy takes no em dashes — see AGENTS.md.)
   - **Match the size of the fix to the size of the issue.** A new shared component, a new
     prop on a shared primitive, or a refactor of adjacent code is rarely warranted by an
     `S` bug. If you believe it is, justify it and expect to be challenged.
3. **`AskUserQuestion` only when a wrong guess costs more than asking.** The test is
   whether being wrong would throw away work already done — not whether the choice is
   interesting. A decision you can state in the summary and reverse in one edit is one you
   should just take. Decide the rest yourself and say which way you went.
4. **How formal to be is a judgment call — state it out loud.** Default to a conversation.
   Call `EnterPlanMode` when the change is big enough that a written plan is worth
   reviewing, or whenever the user asks.
5. **Close by naming what comes next**, briefly, so the handoff is clear: the gates
   (`pnpm turbo typecheck lint test`, then `pnpm test:integration`), the `## See it
   working` section every user-visible PR needs, and that the merge hook reclaims this
   worktree automatically once the PR is merged.

## When something goes wrong

| Symptom | What it means | Do this |
| --- | --- | --- |
| `Branch already checked out` | someone is already on it | `pnpm wt:list`, enter that worktree instead of creating one |
| `Already exists: <path>` | a previous run got that far | enter it; re-run `pnpm wt:setup <path> [--db]` if it looks half-built |
| "worktree was created but setup did not finish" | setup died mid-run | run the retry line it printed; the worktree is fine |
| `No built Planazo.app found in DerivedData` | no Dev Client to install | build once from the main checkout (`npx expo run:ios --device "$IOS_SIMULATOR" --no-bundler`), then re-run `wt:setup` |
| `EnterWorktree` refuses the path | not a first entry, or not in `git worktree list` | stay in main; pass the worktree's absolute path as cwd on every command |
| Issue is already In Progress | another session may own it | check `pnpm wt:list` for its worktree and ask the user before starting a second one |
| Anything database-shaped, or the integration suite refusing | a guard fired | invoke the **`wt`** skill; it has every refusal and its remedy. Do not work around one |
