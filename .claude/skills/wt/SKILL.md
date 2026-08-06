---
name: wt
description: Drive Planazo's worktree + database workflow — create/start/list/remove worktrees, choose shared vs --db mode, run integration tests from any checkout, iterate on migrations, and interpret every guard refusal. Use when creating or working in a worktree, when the integration suite refuses to run, or when managing branch databases.
---

# Planazo worktree & database driver

The one rule everything reduces to: **your database is whatever your checkout's
root `.env` says.** `wt:setup` writes it; the test suite reads it itself; never
export another environment's values over it. The scripts below enforce the
boundaries — your job is to pick the right command, not to reason about safety.

## Decision: shared or `--db`?

Read the Linear issue first (`mcp__linear__get_issue`) — never guess from the
issue number.

- **`--db` (own branch database)** when the work implies a schema change:
  migrations, RLS/policies, RPCs, triggers, new tables/columns/indexes,
  `SECURITY DEFINER`.
- **shared (default)** for everything else: UI, copy, styling, navigation,
  state, tests, config. Free and instant.
- Genuinely ambiguous → **shared**. Upgrading later is one command
  (`pnpm wt:setup --db`); guessing `--db` wrongly costs money and minutes.

## Commands

```bash
pnpm wt:new fix/pla-NN-slug          # new worktree, shared mode
pnpm wt:new feat/pla-NN-slug --db    # new worktree with its own branch DB
pnpm wt:new chore/pla-NN-slug --no-sim  # no simulator: nothing on screen changes
pnpm wt:setup --db                   # upgrade an existing worktree to its own DB
pnpm wt:setup --sim                  # build the simulator after all
pnpm wt:start                        # boot its simulator + Metro, connect the app
pnpm wt:start --login                # …and sign in as the demo user
pnpm wt:list                         # all worktrees; flags merged branches + orphaned DBs
pnpm wt:rm <slug>                    # delete worktree + simulator + branch DB
pnpm wt:db:reset                     # wipe + rebuild THIS worktree's branch DB (see below)
pnpm test:integration                # the suite, from ANY checkout, against ITS database
```

## Testing from a worktree

`pnpm test:integration` works everywhere — main (~2s), shared worktrees (~2s,
main's local stack), `--db` worktrees (~40s, their own branch DB). Tests create
UUID-namespaced users/groups and delete exactly what they created: concurrent
runs never collide, nothing needs resetting between runs, and green CI (which
rebuilds a fresh stack with YOUR branch's migrations) is the merge gate.

## Iterating on migration SQL (`--db` worktrees)

`db push` matches migrations by **version timestamp, not content**. First
apply of a new file works via `supabase db push --db-url "$SUPABASE_DB_URL"`;
but once a version is recorded, editing its file does nothing — push skips it
silently. So the loop is:

1. Write the migration → `wt:setup --db` or `db push` applies it.
2. Need to change it? Edit the file, then **`pnpm wt:db:reset`** — wipes the
   branch DB, re-applies every migration from the current files, reseeds.
   The app then needs a re-login (fresh JWTs) and Metro a `--clear` restart.
3. Never renumber or edit a migration that is already on main — CI rejects it;
   fix forward with a new migration.

## When the suite refuses to run — meaning and fix

Refusals are the guards working, not the suite being broken. Do not work
around them; run the named remedy.

| Message contains | It means | Fix |
| --- | --- | --- |
| "not a branch-mode worktree… only targets a loopback stack" | Hosted URL in a checkout that owns no hosted DB (wrong env exported, or someone else's DB) | `unset SUPABASE_URL…`; if this branch should own a DB: `pnpm wt:setup --db` |
| "declares PLANAZO_DB_MODE=branch… loopback URL here" | `wt:setup --db` died before rewriting `.env`; checkout still points at main's stack | re-run `pnpm wt:setup --db` |
| "This URL's ref does not match" | `.env` points at a different worktree's branch DB | re-run `pnpm wt:setup --db` |
| "branch adds migrations but the worktree is in shared DB mode" | Schema work started in a shared worktree | `pnpm wt:setup --db` |
| "missing N migration(s) from this checkout" | Target DB is behind the checkout (pulled main, or rebased) | loopback: `supabase migration up` (from main) · branch: `supabase db push --db-url "$SUPABASE_DB_URL"` |
| "uncommitted edits… still running the OLD content" | You edited an already-applied migration | `pnpm wt:db:reset` (branch) · `supabase db reset` from main (loopback — wipes shared QA data) |
| "No Postgres URL… cannot see" | `.env` predates `SUPABASE_DB_URL` being recorded | re-run `pnpm wt:setup --db` |

## Hard boundaries (scripts enforce these — don't fight them)

- Never `supabase start` / `db reset` from a worktree against the shared stack:
  `config.toml` has a fixed `project_id`, so you'd attach to and wipe main's.
- Never touch another worktree's simulator, Metro port, or branch database
  (`pnpm wt:list` shows ownership).
- Never `config push` at the parent project — branch DBs only. Production's
  auth config keeps production semantics.
- Never push migrations to production by hand — the CI `deploy` job does it on
  merge, after tests pass.

## After merging

**This is automatic for the worktree you are in.** A PostToolUse hook on
`gh pr merge` (`.claude/settings.json`) runs `scripts/worktree-reap.sh`, which
reclaims THIS worktree — worktree, simulator, branch DB — and then pulls main
and applies any new migrations to its local database. It reclaims nothing else:
other worktrees belong to other sessions, and their branch DBs are live.

It refuses rather than deletes when the PR for the branch is not `MERGED`, or
when `wt:rm` objects (a dirty tree, most often). When it refuses it says why,
and the fix is yours to carry out — it will not retry itself.

Other people's merged worktrees still show up in `pnpm wt:list` flagged
`MERGED` — that is a prompt for whoever owns them, not a to-do list. Ask before
reclaiming one you did not create; a flagged worktree is often a session still
working in it. A `branch`-mode one says its database is billing, because that
flag is costing money for as long as it goes unread.

The flag is a merged-PR question, asked of GitHub. If `wt:list` says it could
not reach GitHub, believe it: nothing is flagged that run, and a finished
worktree will look exactly like an unfinished one.
