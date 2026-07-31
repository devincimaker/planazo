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
- Integration tests (`packages/integration-tests`) run from **main** or in CI.
  They hard-refuse non-loopback URLs, so they can never target a branch DB.
- No native rebuild is needed for JS-only work: the Dev Client is a generic
  shell and `EXPO_PUBLIC_*` is inlined by Metro at bundle time. Rebuild only
  when `app.json` or the native dependency set changes.

### iOS Simulator

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
