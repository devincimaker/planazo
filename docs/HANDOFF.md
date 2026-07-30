# Planazo redesign — handoff notes

_Last updated 2026-07-30. **The MVP is complete.** Phases 0–8 are merged to main (PRs #2–#12), and the final phase — the integration test suite — is on branch `phase-9-integration-tests`. Post-MVP ideas live in `tasks.md`._

**Ground rules (settled, do not relitigate):** React Native/Expo SDK 54; Supabase-only backend (RLS + SECURITY DEFINER RPCs + one Edge Function). User-facing word is **"Groups"**, never "Circles". Style ONLY from `theme/tokens.ts` + `components/ui`. The user is sensitive to unflagged structural changes and deviations from the design docs — flag explicitly, and where the design has no answer, **discuss before implementing**. Dates render en-GB. **HARD RULE — never string-parse dates on Hermes**: build via `new Date(y, m-1, d, h, min)`. Design sources: `docs/design/Planazo Screens Final.dc.html` + `Planazo Endings.dc.html` (newest-iteration-first ordering).

## Test suites

Three layers, all in CI (`.github/workflows/ci.yml`):

- **Shared unit tests** — `packages/shared`, vitest (`pnpm --filter @planazo/shared test`). Plan-logic math.
- **Mobile component tests** — `apps/mobile`, jest-expo + RNTL (`npx jest --forceExit` in apps/mobile). Screens with mocked Supabase.
- **Integration tests** — `packages/integration-tests`, vitest + supabase-js against the **local** Supabase stack. This is the regression net for everything the DB does: RLS policies (incl. the pending-invitee visibility fix `20260729000002`), the RPCs (`lock_plan`, `cancel_plan`/`restore_plan`, `reopen_plan`, `leave_group`, friend requests, group invites, `set_group_notify`, `get_group_by_invite_code`), and triggers (`handle_new_user` handles, `trg_notify_plan_created` fan-out, `trg_push_notification` never breaking inserts when Vault is empty).

Running the integration suite locally: `supabase start`, then `pnpm --filter @planazo/integration-tests test`. It discovers keys via `supabase status -o env`, **refuses any non-loopback URL** (it signs up throwaway users and mutates freely), creates all data as real authenticated clients (service role for teardown only), and deletes everything it created. `supabase/config.toml` raises the local signup rate limit to 500/5min because a full run signs up ~22 users. CI runs it in the `migrations` job after a full `supabase start` (`db start` alone has no auth).

Known RLS looseness, deliberately not "fixed" without discussion: the `group_members` INSERT policy only checks `auth.uid() = user_id` — anyone who learns a group UUID can insert their own membership, with any role including `admin`. The app's join paths (invite code, invite RPC) don't rely on it being tighter, but it's a real hole to close post-MVP.

## Workflow a fresh session must know

- Slice = branch off main → code + tests → `npx tsc --noEmit` + `npx jest --forceExit` (both in apps/mobile; root tsc is a decoy) → simulator verify → PR (merge only when the user says). 117 mobile + 38 shared + 29 integration tests green.
- **Supabase CLI login works** (re-authed 2026-07-30): `supabase projects list`, `functions deploy`, `secrets set` all fine. DB pushes still via `supabase db push --db-url "$SUPABASE_DB_URL"` (root `.env`; also holds `PUSH_TRIGGER_SECRET`). Ad-hoc SQL: `psql "$SUPABASE_DB_URL" -c "…"` (live) or port 55322 locally. `pnpm db:gen:types` reads the LOCAL instance — run `supabase migration up --local` (or `db reset`) first. Root `.env`'s `SUPABASE_SERVICE_ROLE_KEY` is STALE — don't use it; Edge Functions get a valid one injected at runtime.
- **Simulator:** iPhone 16 Pro, UDID `CA8D5129-C019-44E6-8909-070CDD2924CE`; Metro on **8083** (8081 = the user's thrive project); connect via `xcrun simctl openurl <udid> "com.planazo.app://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8083"`; auth `planazo://dev-login?email=demo.planazo%40example.com&password=Planazo123%21`. Taps: `idb ui tap <x> <y> --udid` (points = px ÷ 3); an RN Switch in a formSheet only responds with `--duration 0.1`. Sim pushes: `xcrun simctl push <udid> com.planazo.app payload.json` with Expo's APNs shape (`{"aps": {...}, "body": {custom data}}`) — needs notification permission granted first.
- **Physical iPhone** (devicectl id `2E6599A9-E409-5575-9ECF-789D62798132`): first-time builds need raw `xcodebuild -allowProvisioningUpdates` (expo CLI omits the flag), then `xcrun devicectl device install app --device <id> <DerivedData .app>`. If `ios/` is stale vs app.json plugins, `npx expo prebuild -p ios` first. The dev client does NOT auto-discover Metro — enter `http://<Mac LAN IP>:8083` manually.
- **Mobile tests:** RNTL v14 — `render`/`fireEvent` async, use `screen.*`. Supabase mock-chain patterns: `app/(app)/(tabs)/__tests__/index.test.tsx`, `plan/[id]/__tests__/index.test.tsx`. Jest hoisting gotcha: declare mocks inside the `jest.mock` factory + `jest.requireMock`; mutable mock state needs a getter (see `lib/__tests__/push.test.ts`).
- Deliberate QA data on live: demo user has 4 accepted friendships; demo plans `dddd0000-*`. Delete any rows you create on the live DB after verifying.
