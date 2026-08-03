#!/usr/bin/env python3
"""Drive the iOS simulator by accessibility label.

    sim.py ls                  # every labelled element, with y positions
    sim.py tap "Change"        # substring match, case-insensitive
    sim.py tap "Open" --exact  # exact match
    sim.py unblock             # clear the SpringBoard "Open in …?" alert
    sim.py reboot              # shutdown + boot + wait until taps work again
    sim.py ready               # wait until accessibility answers (after a boot)
    sim.py shot out.png        # screenshot

The UDID comes from this checkout's .env.worktree or apps/mobile/.env — by UDID
if one is recorded, otherwise by resolving the simulator *name*, since the main
checkout's .env only carries `IOS_SIMULATOR=iPhone 16 Pro`. Never hardcode a
UDID from a previous session: each worktree owns a different simulator.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

# Buttons that mean "yes" on a system alert, best answer first.
CONFIRM_LABELS = ("Open", "Allow", "OK", "Continue")

# AX types that actually receive a tap. A StaticText with the right words in it
# will happily accept a tap and do nothing, which is how the "Open in …?" alert
# convinced everyone it was untappable — see unblock().
TAPPABLE = ("Button", "Cell", "Link", "SwitchButton", "TextField",
            "SecureTextField", "SegmentedControl")


def idb_bin():
    """idb is usually on PATH, but agents inherit odd PATHs. Look where it lives."""
    found = shutil.which("idb")
    if found:
        return found
    fallback = Path.home() / ".local/bin/idb"
    if fallback.is_file():
        return str(fallback)
    sys.exit("idb not found on PATH or at ~/.local/bin/idb.")


IDB = idb_bin()


def resolve_name(name):
    """Simulator name -> UDID. Prefers a booted one; exact name match only,
    so 'iPhone 16 Pro' never resolves to 'iPhone 16 Pro Max'."""
    out = subprocess.run(["xcrun", "simctl", "list", "devices"],
                         capture_output=True, text=True, timeout=60).stdout
    matches = re.findall(rf"^\s*{re.escape(name)} \(([0-9A-F-]{{36}})\) \((\w+)\)",
                         out, re.M)
    if not matches:
        return None
    for udid, state in matches:
        if state == "Booted":
            return udid
    return matches[0][0]


def find_udid():
    if os.environ.get("PLANAZO_SIM_UDID"):
        return os.environ["PLANAZO_SIM_UDID"]
    here = Path.cwd()
    for base in [here, *here.parents]:
        for fname, key in ((".env.worktree", "PLANAZO_SIM_UDID"),
                           ("apps/mobile/.env", "IOS_SIMULATOR_UDID")):
            f = base / fname
            if f.is_file():
                m = re.search(rf"^{key}=(.+)$", f.read_text(), re.M)
                if m and m.group(1).strip():
                    return m.group(1).strip()
        # Main's .env records the simulator by name, not UDID.
        env = base / "apps/mobile/.env"
        if env.is_file():
            m = re.search(r"^IOS_SIMULATOR=(.+)$", env.read_text(), re.M)
            if m and m.group(1).strip():
                udid = resolve_name(m.group(1).strip())
                if udid:
                    return udid
                sys.exit(f"No simulator named {m.group(1).strip()!r} exists. "
                         "Check apps/mobile/.env against `xcrun simctl list devices`.")
        if (base / ".git").exists():
            break
    sys.exit("No simulator found. Set PLANAZO_SIM_UDID, or run from a checkout "
             "whose .env.worktree / apps/mobile/.env names one.")


UDID = find_udid()


def elements():
    out = subprocess.run(
        [IDB, "ui", "describe-all", "--udid", UDID],
        capture_output=True, text=True, timeout=120,
    ).stdout.strip()
    if not out.startswith("["):
        return []
    return [
        (e["AXLabel"], e.get("type") or "?", e["frame"])
        for e in json.loads(out)
        # AXLabel is present-but-null on plenty of elements, so guard on the
        # value, not the key.
        if (e.get("AXLabel") or "").strip()
    ]


def fingerprint(els):
    return tuple(sorted(label for label, _, _ in els))


def tap_xy(x, y):
    subprocess.run([IDB, "ui", "tap", "--udid", UDID, str(round(x)), str(round(y))],
                   check=True, capture_output=True, timeout=60)


def choose(els, needle, exact=False):
    """Pick the element to tap, preferring one that can actually receive it.

    Tree order alone is a trap: the "Open in …?" alert lists its *title* before
    its buttons, so the first substring match for "Open" is a StaticText, and
    tapping it silently does nothing. Rank tappable over merely-matching, and
    exact over partial.
    """
    matches = [e for e in els
               # The root Application element spans the whole screen and shares
               # the app's name, so tapping "its centre" is a blind tap in the
               # middle of whatever is showing. Never a target.
               if e[1] != "Application"
               and (e[0] == needle if exact else needle.lower() in e[0].lower())]
    if not matches:
        return None, []
    ranked = sorted(
        matches,
        key=lambda e: (e[1] not in TAPPABLE,      # tappable types first
                       e[0] != needle,             # then exact label
                       len(e[0])),                 # then the tightest match
    )
    return ranked[0], ranked[1:]


def tap(needle, exact=False, quiet=False):
    before = elements()
    pick, others = choose(before, needle, exact)
    if not pick:
        if not quiet:
            print(f"NOT FOUND: {needle!r}")
            if is_alert(before):
                print("A system alert is up. Run: sim.py unblock")
        return False

    label, etype, f = pick
    x, y = f["x"] + f["width"] / 2, f["y"] + f["height"] / 2
    tap_xy(x, y)
    time.sleep(1.5)

    # Report whether the tap did anything. Claiming success on a tap that
    # landed on a label is what sends agents off rebooting.
    changed = fingerprint(elements()) != fingerprint(before)
    if not quiet:
        print(f"tapped {label!r} ({etype}) at ({x:.0f},{y:.0f})")
        print("screen changed" if changed else
              "screen did NOT change — the tap may have landed on a non-target")
        if others and not changed:
            print("other matches:", ", ".join(f"{l!r} ({t})" for l, t, _ in others[:4]))
    return True


def is_alert(els=None):
    """The SpringBoard "Open in <app>?" alert (and its permission-prompt kin):
    a tiny tree whose only buttons are a confirm and a Cancel."""
    els = elements() if els is None else els
    if len(els) > 6:
        return False
    labels = {label for label, _, _ in els}
    buttons = {label for label, t, _ in els if t == "Button"}
    return bool(buttons & set(CONFIRM_LABELS)) and (
        "Cancel" in labels or any(l.startswith("Open in") for l in labels)
    )


def unblock(max_rounds=4):
    """Dismiss the SpringBoard alert, then fall back to a reboot.

    Each queued `simctl openurl` raises its own alert, so clearing one can
    reveal the next. Loop rather than concluding the tap failed.
    """
    for round_no in range(1, max_rounds + 1):
        els = elements()
        if not els:
            print("Accessibility is not answering. Rebooting.")
            return reboot()
        if not is_alert(els):
            print("No system alert up — nothing to clear.")
            return True

        target = next(
            (e for want in CONFIRM_LABELS
             for e in els if e[1] == "Button" and e[0] == want),
            None,
        )
        if not target:
            print("Alert up but no confirm button found:",
                  [l for l, _, _ in els])
            break

        label, _, f = target
        tap_xy(f["x"] + f["width"] / 2, f["y"] + f["height"] / 2)
        time.sleep(1.5)
        if not is_alert():
            print(f"cleared with {label!r} after {round_no} tap(s)")
            return True
        print(f"round {round_no}: tapped {label!r}, another alert is still up")

    print("Alert survived tapping. Rebooting the device.")
    return reboot()


def wait_ready(timeout=90):
    """A device reports Booted long before it can be driven: taps and
    describe-all come back roughly 15s later. Wait for the tree, not the state."""
    start = time.time()
    while time.time() - start < timeout:
        if len(elements()) > 3:
            print(f"accessibility ready after {time.time() - start:.0f}s")
            return True
        time.sleep(2)
    print(f"still not answering after {timeout}s")
    return False


def reboot():
    subprocess.run(["xcrun", "simctl", "shutdown", UDID], capture_output=True, timeout=120)
    subprocess.run(["xcrun", "simctl", "boot", UDID], capture_output=True, timeout=120)
    return wait_ready()


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "ls"
    if cmd == "ls":
        for label, t, f in elements():
            print(f"{t:14} {label!r} y={f['y']:.0f}")
    elif cmd == "tap":
        ok = tap(sys.argv[2], exact="--exact" in sys.argv)
        sys.exit(0 if ok else 1)
    elif cmd == "unblock":
        sys.exit(0 if unblock() else 1)
    elif cmd == "reboot":
        sys.exit(0 if reboot() else 1)
    elif cmd == "ready":
        sys.exit(0 if wait_ready() else 1)
    elif cmd == "shot":
        subprocess.run(["xcrun", "simctl", "io", UDID, "screenshot", sys.argv[2]],
                       check=True, capture_output=True, timeout=60)
        print(f"wrote {sys.argv[2]}")
    else:
        sys.exit(__doc__)
