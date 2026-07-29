# Planazo redesign — handoff notes

_Last updated 2026-07-29. Phases 0–5 (foundation, design system, shell+feed, plan detail, create sheet, full groups suite incl. friends) are merged to main — see git history and closed PRs #2–#9 for details. Two phases remain: **Profile + feedback**, then **Endgame**._

**Ground rules (settled, do not relitigate):** React Native/Expo SDK 54; Supabase-only backend (RLS + SECURITY DEFINER RPCs; Edge Functions later for push). User-facing word is **"Groups"**, never "Circles". Style ONLY from `theme/tokens.ts` + `components/ui` (no raw hex in screens; numeric paddings from design markup are fine). The user is sensitive to unflagged structural changes and to deviations from the design doc — if building less or differently than the design shows, say so explicitly first. Dates render en-GB app-wide. **HARD RULE — never string-parse dates on Hermes**: `new Date('YYYY-MM-DD')` is UTC midnight and naive datetime strings disagree with the native picker; always build via `new Date(y, m-1, d, h, min)`. Plan semantics: host counts from creation; cap ≥ min (exact headcount valid).

**Design source of truth:** `docs/design/Planazo Screens Final.dc.html` (committed byte-faithful snapshot — Read only the slice you need; **sections are ordered newest-iteration-first**, so an earlier line number can supersede a later one). Product prose: `docs/planazo-design-context.md`. Behavior script at the tail (~2560–3189); `renderVals()` (~2999) holds the profile state (name/photo/edit/draft, notif + calendar toggles).

## Next phase: Profile + feedback (12b/12c, 11b, 14a–c)

Anchors: **14a** feedback row ~line 598, **14b** compose ~652, **14c** sent + screenshot entry ~718, **12b** profile sheet ~776, **12c** edit state ~883, **11b** photo options ~1033. (11a ~932 and 10a/10b ~1092/1171 are older iterations superseded by 12b/12c — the menu-sheet direction is a settled decision.)

What the design specifies:

- **12b — profile sheet**, opened from the feed avatar. **Read-only**: name + avatar big at the top, "@handle · in N groups", and ONE outlined **Edit name & photo** button as the only way in ("no tap in this sheet can change anything by accident"). Below: rows/switches — "Add to my calendar" toggle, email, a **Send feedback** group sitting directly above the **version number** (14a: "that's where people already look when something's wrong"), sign out.
- **12c — edit open**: name field + avatar with camera badge; **Save greys out until something actually changed**. The handle is shown but fixed: "@rovidal · your handle stays put" (invite links point at it — column already exists and is permanent by design).
- **11b — photo sheet**: Take photo / Choose from library / **Use my initial instead** (the honest default).
- **Feedback — two entry points (USER DECISION 2026-07-29, diverges from 14a's auto-grab; do not "fix" back to the design):**
  1. **OS screenshot taken while the app is open** → open the feedback bottom sheet with that screenshot attached, note field, Send. Implementation: iOS only reports *that* a screenshot happened (expo-screen-capture listener), never the image — so re-capture the current screen with react-native-view-shot the instant the event fires (user is still on that screen; same pixels, no photo permission). If they annotated the screenshot first and want that version, the library picker in the sheet covers it.
  2. **Send-feedback row in the profile sheet** → **no auto-attached screenshot at all** (by the time anyone reaches the row they've navigated back through the feed, so a grab of "the screen you were on" is mostly feed shots). Instead: optional pick-from-library, kind picker, optional text, Send.
- **14b/14c conventions still apply**: compose = pick what kind of thing it is + optional one-liner; attachment swappable/droppable; Send drops you back where you were with a quiet confirmation, no thank-you screen.

Needs:
- **Migrations**: `feedback` table (user, kind, message, screenshot path) + a storage bucket for feedback screenshots (an `avatars` bucket already exists from migration `…007`; avatar upload itself may just need wiring).
- **Native deps → one rebuild**: `expo-screen-capture` (the screenshot listener — **core scope**, it's entry point 1) + `react-native-view-shot` (the instant re-capture that listener path needs). `expo-image-picker` is **already installed and in the current build**.

## Then: Endgame (concretely, in likely order)

1. **Push notifications** — the only genuinely new machinery. `expo-notifications` (native → rebuild), register the token into `profiles.push_token` (column exists), and an **Edge Function** that delivers rows from the `notifications` table via Expo's push API. The lock/cancel RPCs already write those rows; add new-plan notifications honoring `group_members.notify_new_plans` (toggle already live in Manage).
2. **Cancelled/expired plan states** — cancelled plans are currently just filtered out of feed/group lists; surface them properly, and decide what happens to open plans whose date has passed (expire vs. badge).
3. **Integration test suite** against local Supabase in CI — real RLS/RPC coverage. (Motivating bug: mocked tests couldn't see that pending invitees were RLS-blocked from reading a group's name; only the on-device pass caught it.)
4. **Data hygiene** — re-stamp flexible-plan date options seeded before PR #6: they carry UTC-midnight dates and can display a day early on negative-offset timezones. New plans are correct.

## Workflow a fresh session must know

- Slice = branch off main → screens + tests → `npx tsc --noEmit` + `npx jest --forceExit` (both in apps/mobile) → simulator verify → PR (merge commits, only when the user says).
- **Simulator:** iPhone 16 Pro, UDID `CA8D5129-C019-44E6-8909-070CDD2924CE`. Metro on **8083** (8081 belongs to the user's thrive project; check `lsof -i :8083`): `npx expo start --port 8083` in apps/mobile, connect via `xcrun simctl openurl <udid> "com.planazo.app://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8083"`. Auth: `planazo://dev-login?email=demo.planazo%40example.com&password=Planazo123%21`. Onboarding blocker: `xcrun simctl spawn <udid> defaults write com.planazo.app isOnboardingFinished -bool true`.
- **Tapping works:** `idb ui tap <x> <y> --udid <udid>` (idb at `~/.local/bin/idb`; coordinates in points = screenshot pixels ÷ 3). `idb ui text` appends at the cursor — navigate away/back to reset a field rather than fighting backspace. Screenshots: `xcrun simctl io <udid> screenshot <path>`. Tap-throughs catch real bugs (two date bugs and one RLS bug so far); still prefer deep-link-reachable states — gallery `planazo://design-gallery?y=<px>`, create sheet `planazo://plan/create?...`, new group `planazo://group/new?name&desc&color&y` (route `getId` mounts fresh per param set — copy this pattern).
- **Tests:** RNTL v14 — `render`/`fireEvent` are **async, await them**; use `screen.*`. Supabase mock-chain patterns: `app/(app)/plan/__tests__/create.test.tsx` and the status-keyed chain in `app/(app)/(tabs)/__tests__/groups.test.tsx`.
- **DB:** push with `supabase db push --db-url "$SUPABASE_DB_URL"` (URL in root `.env`; CLI login on this machine lacks project access). Ad-hoc SQL: `psql "$SUPABASE_DB_URL" -c "…"`. **`pnpm db:gen:types` generates from the LOCAL instance** — run `supabase migration up --local` first or types come out stale. Delete any real rows you post from the sim; current deliberate QA data: demo user has 4 accepted friendships (alexrivera, luciachen, mayapatel, biancastone).
- Native dep added → rebuild: `npx expo run:ios --device "iPhone 16 Pro" --no-bundler` (full launch sequence in CLAUDE.md).
