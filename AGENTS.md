# Planazo — agent instructions

Canonical for every agent (Claude Code, Codex, …). `CLAUDE.md` just points here.

## Product copy

**Never use an em dash (`—`) in product copy or interfaces.** It reads as
machine-written, and Planazo's voice is a person talking. This covers every
string a user can see: app screens, toasts, alerts, placeholders, push
notification text, share sheets, the landing page and legal pages
(`apps/web/lib/copy.ts`, `apps/web/lib/legal.ts`, both languages), and the App
Store listing in `store-assets/APP-STORE.md`.

Rewrite rather than substitute a different dash. The replacement depends on the
job the dash was doing:

| The dash was… | Use instead |
| --- | --- |
| joining two full sentences | a full stop, and capitalise the second |
| introducing a list or a definition | a colon |
| tacking on an aside | a comma |
| bracketing a parenthetical (a pair of dashes) | parentheses |
| labelling something optional | `(optional)` |

Splitting into two shorter sentences is almost always the best answer. If the
result reads worse than the original, the sentence wanted restructuring anyway.

Two things this rule does **not** cover:

- **Code comments and test names.** Prose for developers, not users. Leave them.
- **The `—` empty-value glyph** (`{cap ?? '—'}`), which is typography standing
  in for "no value", not a sentence. Leave it.

Hyphens in compound words (`five-a-side`, `invite-only`) are unaffected.

## Linear Integration

- **Workspace**: fioris
- **Team**: Planazo
- **Project URL**: https://linear.app/fioris/team/PLA/all
- **Issue Identifier**: PLA

## Worktrees

Work can happen in the main checkout **or** in an isolated worktree. Both are
first-class — main is deliberately *not* managed by the `wt:*` tooling, so it
stays the simple single-threaded path.

```bash
pnpm wt:new pla-17          # new worktree, shares main's local DB (UI/JS work)
pnpm wt:new pla-17 --db     # ...with its own hosted Supabase branch database
pnpm wt:setup --db          # give an existing worktree its own DB, mid-work
pnpm wt:start               # boot its simulator + Metro, connect the app
pnpm wt:list                # every worktree's slot, plus orphaned branch DBs
pnpm wt:rm pla-17           # delete branch DB + simulator + worktree
```

Worktrees live in `../planazo-worktrees/<slug>`. Each owns exactly three things,
recorded in its gitignored `.env.worktree`: a **Metro port**, a **simulator**,
and a **database** (`PLANAZO_DB_MODE` = `shared` or `branch`).

### Asked to make a worktree for a Linear issue

When the user says something like *"create a worktree for PLA-20"*:

1. **Read the issue first** (`mcp__linear__get_issue`). You need its title, body
   and labels to choose the database mode — do not guess from the number.
2. **Pick the mode.** Use `--db` when the issue implies a **schema change**:
   migrations, RLS or policies, RPCs, triggers, new tables/columns/indexes,
   `SECURITY DEFINER`, or anything the DB enforces. Otherwise use the default
   shared mode: UI, copy, styling, navigation, state, loading/error states,
   tests, config.
   **When it is genuinely ambiguous, choose shared** — it is free and instant,
   and `pnpm wt:setup --db` upgrades in place the moment you discover you need
   a real database. Guessing "shared" wrongly costs one command; guessing
   "--db" wrongly costs money and minutes.
3. **Name the branch off the issue**, matching the existing convention:
   `fix/pla-20-<short-slug>` or `feat/pla-20-<short-slug>`.
4. **Run it**, then say which mode you chose and why:
   ```bash
   pnpm wt:new fix/pla-20-enforce-plan-cap          # shared
   pnpm wt:new feat/pla-31-group-roles --db         # own database
   ```
5. `cd` into the worktree and `pnpm wt:start` to bring up its simulator and Metro.

**Rules for any session working inside a worktree:**

- Read `.env.worktree` and `apps/mobile/.env` to learn *your* simulator, Metro
  port, and database. Never assume main's.
- **Never touch another worktree's simulator, Metro port, or branch database**,
  and never kill a Metro you did not start. Check `pnpm wt:list` first.
- **Do not run `supabase start` / `db reset` from a worktree.** `config.toml` is
  tracked with a fixed `project_id`, so a worktree attaches to *main's* stack —
  a reset there wipes main's data and every other shared-mode worktree's.
- If `PLANAZO_DB_MODE=shared`, your database **is main's**. Editing
  `supabase/migrations/` changes main's schema. Run `pnpm wt:setup --db` first.
- Integration tests run from **any checkout** against that checkout's own
  database — see **Testing & databases** below.
- No native rebuild is needed for JS-only work: the Dev Client is a generic
  shell and `EXPO_PUBLIC_*` is inlined by Metro at bundle time. Rebuild only
  when `app.json` or the native dependency set changes.

## Testing & databases

One rule: **your database is whatever your checkout's root `.env` says.**
`wt:setup` writes it — main's local stack in shared mode, the branch's own
hosted database with `--db` — and main's `.env` points at its local stack.
Never export another environment's values over it; the suite reads `.env`
itself.

- **Unit/component tests** (jest in `apps/mobile`, vitest in `packages/shared`):
  no database at all. Run them anywhere, always.
- **Integration tests**: `pnpm test:integration` from any checkout. On a
  loopback stack a full run is ~2s; against a worktree's branch database ~40s.
  Tests create their own UUID-namespaced users and groups and delete exactly
  what they created, so concurrent runs from different worktrees never collide
  and nothing needs resetting between runs.
- The suite **refuses to run rather than lie**, with the fix in the message:
  - against a database this checkout doesn't own — only loopback or the
    worktree's own `PLANAZO_BRANCH_REF` are accepted, so production is
    unreachable by construction;
  - from a shared-mode worktree whose branch adds migration files (the verdict
    would be about main's schema, not yours — `pnpm wt:setup --db` first);
  - when the checkout has migrations the target database hasn't applied.
    Fix: `supabase migration up` (loopback) or
    `supabase db push --db-url "$SUPABASE_DB_URL"` (branch DB).
- **Migrations flow one way**: your branch → its branch DB (at `wt:setup`, or
  by hand while iterating) → CI's throwaway stack (every PR) → production (the
  `deploy` CI job pushes on merge to main, after tests pass — never by hand) →
  every other checkout pulls and applies (`supabase migration up` on main after
  a schema PR lands). Nothing ever rolls back on a shared database; a botched
  branch-DB experiment is discarded with `wt:rm` and rebuilt.
- **Merged migrations are immutable.** `db push` matches migrations by version
  timestamp and silently skips edited content, so CI rejects any change — PR or
  direct push — that modifies, deletes or renames a migration that already
  existed. Fix forward with a new migration; only your branch's own new
  migrations are editable.
- **Editing your own applied migration needs a re-apply.** The same version
  matching means `db push` skips an already-applied migration whose file you
  edited. After editing, run `pnpm wt:db:reset` (wipes and rebuilds this
  worktree's branch DB from the current files + reseeds). The suite refuses to
  run while an applied migration has uncommitted edits.
- **CI is the merge gate.** It runs on GitHub's machines with a fresh stack
  carrying *your branch's* migrations, so a schema branch always gets an
  honest verdict there even when no local database can give one. Local suite
  runs are a convenience, not the safety net.

## Every PR ends with "See it working"

A green CI run says the code does what its tests say. It does not say the
feature is worth having, and the person who has to decide that is reviewing on
a phone-sized screen with limited time. So **every PR that changes anything a
user can see ends with a `## See it working` section**: the shortest path from
a fresh checkout to the change happening in front of them.

Write it for someone who has not read the diff. Name the accounts, name the
taps, say what should appear. If setup is needed, give the exact command, and
prefer one that is already committed over a snippet to paste. Two accounts and
a login are fine; a hand-written SQL console session is not.

```markdown
## See it working

    pnpm wt:new feat/pla-37-waiting-list --db   # if you don't have it
    cd ../planazo-worktrees/feat-pla-37-waiting-list
    pnpm wt:start --login

1. **Full plan.** Top of the feed, "Padel, two courts" caps at 2 and both
   places are gone. The primary reads **"Take the next spot"**, an outline
   button, not the dead "Full" it used to be.
2. **Join.** Tap it. The footer becomes **"You're 2nd in line"** (Lucia is
   already waiting). Open the plan to see "If a spot opens, it's yours."
3. **Watch a place open.** Profile → sign out → sign in as
   `alex.rivera@example.com` / `Planazo123!`, open the same plan, tap
   **Change** to withdraw.
4. **Back to your account.** The plan now reads **"You're in"**, and the
   people row shows you instead of Alex.

Not covered by this walkthrough: promotion by push (the simulator has no
APNs), and the re-lock ordering, which only integration tests reach.
```

That last paragraph matters as much as the steps. **Say what the walkthrough
cannot show**, so nobody reads "verified on device" as broader than it is.

Rules of thumb:

- **A path a real user can take beats a script.** Withdrawing as another
  account proves the trigger fires on the path production uses; deleting the
  row with the service role only proves the trigger exists. Do **not** write a
  per-feature seeding script: `pnpm db:seed:demo` plus taps in the app is the
  walkthrough. If the state you need is genuinely unreachable that way, say so
  in the PR and give the steps to reach it by hand.
- **Screenshots go in the PR body**, especially before/after for anything
  visual. A reviewer who can see it may not need to run it at all.
- **Say when there is nothing to see.** A refactor, a CI change or a migration
  with no UI writes `## See it working` → "Nothing user-visible; the proof is
  the N tests in `<file>`." Silence reads like an oversight.

## iOS Simulator

**Inside a worktree, `pnpm wt:start` does all of this for you** — it boots the
assigned simulator, starts Metro on the assigned port, and connects the app. The
manual steps below are for the **main checkout**.

**CRITICAL:** Always use the simulator specified in `apps/mobile/.env` (`IOS_SIMULATOR`). Never use a different simulator, even if:
- Another simulator is already booted
- The assigned simulator appears to be in use
- The assigned simulator is shut down (boot it first)

Read the `.env` file to get the simulator name, then use that exact simulator for all operations.

#### Building and Launching

**Always use `--no-bundler`** when building with Expo to prevent deep link issues that can launch the app on the wrong simulator:

```bash
# 1. Get the simulator UDID
UDID=$(xcrun simctl list devices | grep "$IOS_SIMULATOR (" | head -1 | grep -oE '[A-F0-9-]{36}')

# 2. Build and install (without launching via deep link)
cd apps/mobile && npx expo run:ios --device "$IOS_SIMULATOR" --no-bundler

# 3. Start Metro on the configured port (if not already running)
npx expo start --port $EXPO_PORT &

# 4. Launch the app with a deep link to the correct Metro port
xcrun simctl openurl "$UDID" "com.planazo.app://expo-development-client/?url=http%3A%2F%2Flocalhost%3A$EXPO_PORT"
```

**Why?**
- Expo's deep links can open on any booted simulator with the app installed, not the one you specified. Using `--no-bundler` and launching by UDID ensures the correct simulator.
- The Dev Client discovers all Metro bundlers on the network. Using `openurl` with the specific port URL forces it to connect to the correct one instead of showing a picker or auto-connecting to the wrong server.
- If `EXPO_PORT` is occupied by another project's Metro (other apps in ~/Solopreneur run their own), start Metro on a free port instead and put that port in the `openurl` URL — do not kill the other project's bundler.

#### Native Packages Require Rebuild

The `ios` folder is **gitignored** and not tracked in version control. When adding a package with native code, you must rebuild the iOS app:

```bash
cd apps/mobile && npx expo run:ios --device "$IOS_SIMULATOR" --no-bundler
```

**Packages that require native rebuild:**
- `expo-image-picker`, `expo-camera`, `expo-location`, `expo-notifications`
- Any `expo-*` package that accesses device hardware or OS APIs
- React Native packages with native modules (check if they have `ios/` or `android/` folders)

**Packages that DON'T require rebuild:**
- Pure JS packages: `lodash`, `date-fns`, `zustand`, `zod`
- Expo packages without native code: `expo-router`, `expo-linking`

If you see an error like `Cannot find native module 'ExponentXxx'`, it means a native rebuild is needed.
