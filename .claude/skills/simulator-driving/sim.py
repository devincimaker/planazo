#!/usr/bin/env python3
"""Drive the iOS simulator by accessibility label.

    sim.py ls                  # every labelled element, with y positions
    sim.py tap "Change"        # substring match, case-insensitive
    sim.py tap "Open" --exact  # exact match
    sim.py shot out.png        # screenshot

The UDID comes from this checkout's .env.worktree (or apps/mobile/.env), never
from a hardcoded value — each worktree owns a different simulator, and driving
someone else's corrupts their session.
"""
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path


def find_udid():
    if os.environ.get("PLANAZO_SIM_UDID"):
        return os.environ["PLANAZO_SIM_UDID"]
    here = Path.cwd()
    for base in [here, *here.parents]:
        for name, key in ((".env.worktree", "PLANAZO_SIM_UDID"),
                          ("apps/mobile/.env", "IOS_SIMULATOR_UDID")):
            f = base / name
            if f.is_file():
                m = re.search(rf"^{key}=(.+)$", f.read_text(), re.M)
                if m and m.group(1).strip():
                    return m.group(1).strip()
        if (base / ".git").exists():
            break
    sys.exit("No simulator UDID found. Run from a worktree with .env.worktree, "
             "or set PLANAZO_SIM_UDID.")


UDID = find_udid()


def elements():
    out = subprocess.run(
        ["idb", "ui", "describe-all", "--udid", UDID],
        capture_output=True, text=True, timeout=120,
    ).stdout.strip()
    if not out.startswith("["):
        return []
    return [
        (e["AXLabel"], e.get("type", "?"), e["frame"])
        for e in json.loads(out)
        if e.get("AXLabel") and e["AXLabel"].strip()
    ]


def tap(needle, exact=False):
    for label, _type, f in elements():
        if label == needle if exact else needle.lower() in label.lower():
            x, y = f["x"] + f["width"] / 2, f["y"] + f["height"] / 2
            subprocess.run(
                ["idb", "ui", "tap", "--udid", UDID, str(round(x)), str(round(y))],
                check=True, capture_output=True, timeout=60,
            )
            print(f"tapped {label!r} at ({x:.0f},{y:.0f})")
            return True
    # Only the alert's three elements visible? That's the SpringBoard alert —
    # no tap will ever land. See SKILL.md, blocker 2: reboot the device.
    labels = [l for l, _, _ in elements()]
    if any("Open in" in l for l in labels) and len(labels) <= 4:
        print("BLOCKED by the SpringBoard 'Open in …' alert — reboot the "
              "simulator (shutdown + boot); taps cannot dismiss it.")
    print(f"NOT FOUND: {needle!r}")
    return False


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "ls"
    if cmd == "ls":
        for label, t, f in elements():
            print(f"{t:14} {label!r} y={f['y']:.0f}")
    elif cmd == "tap":
        ok = tap(sys.argv[2], exact="--exact" in sys.argv)
        time.sleep(1.5)
        sys.exit(0 if ok else 1)
    elif cmd == "shot":
        dest = sys.argv[2]
        subprocess.run(["xcrun", "simctl", "io", UDID, "screenshot", dest],
                       check=True, capture_output=True, timeout=60)
        print(f"wrote {dest}")
    else:
        sys.exit(__doc__)
