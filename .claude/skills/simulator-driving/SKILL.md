---
name: simulator-driving
description: Drive the iOS simulator UI programmatically — tap by label, deep link, screenshot — and get unstuck from the two blockers that trap agents: the Expo dev-menu sheet and the SpringBoard "Open in Planazo?" alert. Use when verifying a change on device, reproducing a bug in the simulator, or when a simulator interaction stops responding to taps.
---

# Driving the simulator

`xcrun simctl` can launch, deep link and screenshot, but it **cannot tap**. Tapping
needs `idb` (already installed at `~/.local/bin/idb`). The helper here taps by
accessibility label, so you never guess coordinates.

## Before anything: know which simulator is yours

Multiple worktrees each own a booted simulator. Driving the wrong one corrupts
someone else's session.

```bash
cat .env.worktree            # PLANAZO_SIM_UDID, PLANAZO_SIM_NAME, PLANAZO_METRO_PORT
pnpm wt:list                 # every worktree's slot
```

`sim.py` resolves the UDID from `.env.worktree` (or `apps/mobile/.env`) on its own.
Never hardcode a UDID from a previous session — they change per worktree.

## The helper

```bash
python3 .claude/skills/simulator-driving/sim.py ls              # labelled elements + y positions
python3 .claude/skills/simulator-driving/sim.py tap "Change"    # substring match
python3 .claude/skills/simulator-driving/sim.py tap "Open" --exact
python3 .claude/skills/simulator-driving/sim.py shot before.png
```

`ls` is your eyes — prefer it over screenshots for control flow, and take
screenshots as evidence for the user. Labels are composed by React Native from
the whole subtree, so a card reads as
`'Weekend Crew, Confirmed, Board games and snacks, …'` — match a distinctive
fragment.

**If a tap "succeeds" but nothing changes**, the tap probably landed on the
element's centre, which on a tall card can be a nested view that swallows it.
Tap nearer the top of the element instead:

```bash
idb ui tap --udid "$UDID" 201 740
```

## Blocker 1 — the Expo dev-menu sheet

On a fresh dev-client launch you get a sheet: *"This is the developer menu…"*
with **Continue**, then the menu itself (Reload / Go home / TOOLS) with
**Close**. It blocks everything under it.

It is ordinary app UI, so `idb` taps work:

```bash
python3 .claude/skills/simulator-driving/sim.py tap "Continue" --exact
python3 .claude/skills/simulator-driving/sim.py tap "Close" --exact
```

**Dismiss it before any deep link** — leaving it up is what causes blocker 2.

## Blocker 2 — the "Open in Planazo?" SpringBoard alert

Symptom: `sim.py ls` shows only three elements —
`'Open in "Planazo"?'`, `Cancel`, `Open` — and the app is unreachable.

**Prevent it outright (the real fix).** The alert is SpringBoard asking to
approve a custom URL scheme; on simulators the approvals are just a plist.
Pre-approve Planazo's schemes and the alert can never appear, no matter what
modal is up when a deep link fires:

```bash
UDID=$(grep PLANAZO_SIM_UDID .env.worktree | cut -d= -f2)
for scheme in planazo com.planazo.app exp+planazo; do
  xcrun simctl spawn "$UDID" defaults write com.apple.launchservices.schemeapproval \
    "com.apple.CoreSimulator.CoreSimulatorBridge-->$scheme" -string "com.planazo.app"
done
```

`wt:setup` does this for every simulator it creates (since PLA-28), so only
simulators from before then — or the main checkout's, if it predates a manual
"Open" tap — still need it. Verified: with the approvals written, the exact
sequence that used to raise the alert (deep link over the dev-client UI)
connects silently.

**If the alert is already up**, it is owned by SpringBoard, not the app, and
that is why agents get stuck. All of these **fail silently** (they report
success and change nothing):

- `idb ui tap` on the Open button — reports the tap, alert stays
- `idb ui key 40` (Return) — no effect
- AppleScript `click at {x,y}` on the Simulator window — lands on the layer *under* the alert
- `xcrun simctl terminate` + relaunch — the alert outlives the app

The only known dismissal is a device reboot — write the approvals first so it
is also the last:

```bash
xcrun simctl shutdown "$UDID" && xcrun simctl boot "$UDID"
until xcrun simctl list devices | grep -q "$UDID) (Booted)"; do sleep 2; done
```

Do not keep retrying taps — that is the loop that eats a session.

## Signing in

```bash
xcrun simctl openurl "$UDID" \
  "planazo://dev-login?email=demo.planazo%40example.com&password=Planazo123%21"
```

`pnpm wt:start --login` does launch + connect + sign-in in one step, and is the
right entry point. The URL-encoding matters (`%40`, `%21`).

## Reverting source while the app runs

To show a bug still reproduces, people revert the fix and let fast refresh
reload. **If your change altered the shape of a `useState` value, fast refresh
keeps the old value and the reverted code crashes on it** — a render error that
is an artifact, not the bug you are demonstrating:

```
Render Error: picked.includes is not a function (it is undefined)
```

Terminate and relaunch instead of reloading — that resets component state while
keeping the session (auth lives in secure store):

```bash
xcrun simctl terminate "$UDID" com.planazo.app; sleep 2
xcrun simctl launch "$UDID" com.planazo.app
```

## A/B proof pattern

Worth the extra minute when verifying a fix: capture the broken state too, or
you have only shown that the app works, not that the fix did anything.

1. Run the sequence on the fixed build → screenshot
2. `git checkout -- <file>`, terminate + relaunch, rerun → screenshot
3. Restore the fix, rerun once more to confirm the good state returns

Always restore in the same command as the revert, so a failure midway cannot
leave the working tree reverted.
