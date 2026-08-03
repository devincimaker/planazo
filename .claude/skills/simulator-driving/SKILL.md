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

`sim.py` resolves the simulator on its own, in this order: `PLANAZO_SIM_UDID`
in the environment, then `.env.worktree`, then `IOS_SIMULATOR_UDID` in
`apps/mobile/.env`, and finally the simulator **name** in `IOS_SIMULATOR`,
looked up through `simctl` (preferring a booted one, and never matching
`iPhone 16 Pro` to `iPhone 16 Pro Max`). That last step is what makes the
helper work in the **main checkout**, whose `.env` records only a name — before
it existed, every `sim.py` call from main died on "No simulator UDID found".

Never hardcode a UDID from a previous session — they change per worktree.

## The helper

```bash
python3 .claude/skills/simulator-driving/sim.py ls              # labelled elements + y positions
python3 .claude/skills/simulator-driving/sim.py tap "Change"    # substring match
python3 .claude/skills/simulator-driving/sim.py tap "Open" --exact
python3 .claude/skills/simulator-driving/sim.py unblock         # clear a system alert
python3 .claude/skills/simulator-driving/sim.py reboot          # reboot + wait until drivable
python3 .claude/skills/simulator-driving/sim.py ready           # wait after someone else's boot
python3 .claude/skills/simulator-driving/sim.py shot before.png
```

`ls` is your eyes — prefer it over screenshots for control flow, and take
screenshots as evidence for the user. Labels are composed by React Native from
the whole subtree, so a card reads as
`'Weekend Crew, Confirmed, Board games and snacks, …'` — match a distinctive
fragment.

**`tap` tells you whether the tap did anything.** It prints `screen changed` or
`screen did NOT change`, and on no-change it lists the other elements your
needle matched. Believe that line: a tap that reports a label but changes
nothing landed on something inert.

Two things `tap` will not do, both of which used to look like "taps are broken":

- **It never taps the root `Application` element**, whose frame is the whole
  screen and whose label is the app's name. `tap "Planazo"` used to tap the
  dead centre of whatever was showing. That is a blind tap, and on the profile
  sheet it lands on *Sign out*.
- **It prefers a tappable type over tree order.** A `StaticText` containing
  your needle no longer wins over a `Button` further down the tree. This is the
  whole story behind blocker 2 below.

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

**If the alert is already up, first move:**

```bash
python3 .claude/skills/simulator-driving/sim.py unblock
```

It taps the confirm *button*, checks the alert actually went, clears any alert
queued behind it, and reboots the device by itself if tapping genuinely fails.
It is safe to run when nothing is stuck (it says so and exits).

### Why this looked unkillable

The alert is owned by SpringBoard rather than the app, and that led to the
conclusion that taps cannot reach it. **idb's taps do reach SpringBoard**:
tapping a home-screen icon by frame through `idb ui tap` launches the app, so
HID events reach SpringBoard's own UI perfectly well.

At least part of the "taps do nothing" reports were the helper aiming at the
wrong element, because the alert lists its **title before its buttons**:

```
StaticText  'Open in "Planazo"?'     <- substring match for "Open" hit this
Button      'Cancel'
Button      'Open'                   <- the thing you meant
```

`sim.py tap "Open"` matched by substring in tree order, so it tapped the
*title*, which is inert. It then printed `tapped 'Open in "Planazo"?'` and
exited 0. A tap that reports success and changes nothing reads as "SpringBoard
is refusing taps", so the next step was a reboot, and the tool's own error text
recommended exactly that. `sim.py` now ranks tappable types above tree order
and reports whether the screen changed, so this specific trap is gone.

**Verified against a live alert.** On a reproduction (recipe below) `unblock`
answered `cleared with 'Open' after 1 tap(s)` and the app came up. One
correctly aimed tap is all it takes, and no reboot is needed. On the same
alert the frames were:

```
StaticText  'Open in “Planazo”?'   x=82  y=419  w=238 h=20   <- old code tapped (201,429)
Button      'Cancel'               x=66  y=459  w=135 h=44
Button      'Open'                 x=201 y=459  w=135 h=44   <- correct target (268,481)
```

The old aim was 52pt above the button, on 20pt-tall inert text. Note the title
uses **curly** quotes, so match on `Open in`, never on the full string.

These do genuinely fail and are not worth retrying: `idb ui key 40` (Return),
AppleScript `click at {x,y}` on the Simulator window (it lands on the layer
*under* the alert), and `simctl terminate` plus relaunch (the alert outlives
the app).

### Reproducing it on purpose

The approval is what makes the alert unreproducible once it has been answered
once. Delete it and the next deep link prompts again, which is how to test any
of this:

```bash
for scheme in planazo com.planazo.app exp+planazo; do
  xcrun simctl spawn "$UDID" defaults delete com.apple.launchservices.schemeapproval \
    "com.apple.CoreSimulator.CoreSimulatorBridge-->$scheme"
done
xcrun simctl terminate "$UDID" com.planazo.app; sleep 2
xcrun simctl openurl "$UDID" "com.planazo.app://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"
```

No reboot is needed for the deletion to take effect. **Write the approvals back
afterwards** with the loop above, or you leave the simulator primed to trap the
next session.

A second reason it looks immortal: **every queued `simctl openurl` raises its
own alert.** Clear one and the next appears, identical. `unblock` loops.

### Do not restart SpringBoard

`launchctl kickstart -k user/foreground/com.apple.SpringBoard` is the obvious
shortcut and it is a trap. Measured on iPhone 16 Pro / iOS 18.5: the home
screen comes back in under a second and looks perfectly healthy, but
**accessibility never returns** — `idb ui describe-all` answers with a single
unlabelled element from then on. Killing and reconnecting `idb_companion` does
not fix it. Only a full device reboot does. You lose more time than you saved.

### Rebooting, and the wait everybody gets wrong

```bash
python3 .claude/skills/simulator-driving/sim.py reboot
```

The old snippet waited for `(Booted)` in `simctl list devices`. That state
arrives in **~1.3s**, while taps and `describe-all` do not work for about
**16s** more. Anything run in that window fails in a way that looks like a
brand new problem. `sim.py reboot` and `sim.py ready` wait for the accessibility
tree instead of the device state, which is the only honest signal.

### When it fires, so you can avoid it

Once a scheme is approved on a simulator, the prompt is spent. Deep links do
**not** raise it against an app that has been opened through that scheme
before: app foregrounded, app backgrounded on the home screen, and app fully
terminated were all tested on an approved simulator and went straight through.

So it fires on a **simulator that has never approved the scheme**, which in
practice means a newly created one, or one where `npx expo run:ios` has just
installed a fresh binary, right before an agent fires its first deep link.
Expect it after a build, not during ordinary driving. Write the approvals above
and it stops being possible at all. Failing that, launch the app once (tap its
icon, or `xcrun simctl launch`) before deep linking, and keep `unblock` in the
loop:

```bash
xcrun simctl openurl "$UDID" "com.planazo.app://expo-development-client/?url=..."
python3 .claude/skills/simulator-driving/sim.py unblock
```

### Retry an `openurl` only when it *says* it failed

The first deep link after a reboot usually dies like this, even though
accessibility is already answering:

```
An error was encountered processing the command (domain=NSPOSIXErrorDomain, code=60)
Simulator device failed to open com.planazo.app://…
Operation timed out
```

That one is safe to repeat: it never reached SpringBoard, so it queued nothing.
A second attempt a few seconds later succeeds.

The opposite case is the dangerous one. **Never retry an `openurl` that
reported success but did not visibly connect** — each of those queues another
"Open in Planazo?" alert behind the one already on screen, which is how a
single stuck alert turns into four. Run `unblock` instead, then deep link once.

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
