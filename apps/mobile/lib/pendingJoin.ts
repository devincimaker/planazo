/**
 * An invite code held across signing in (PLA-77).
 *
 * Tapping an invite link when you have no account lands you on the join screen
 * with nothing to join as. It sends you to sign up and leaves the code here;
 * `app/index.tsx` takes it back out once there is a session and finishes the
 * journey, instead of dropping you on an empty feed with the link already
 * spent. Index and nowhere else: it is the one place that decides where a
 * launch lands (PLA-75), and a second copy of that decision in login and
 * signup is exactly the drift it exists to prevent.
 *
 * Deliberately in memory rather than on disk. It only has to survive a few
 * screens of the same app run, and iOS gives us no way to recover a code from
 * before an install anyway — the second tap on the link is what does that. A
 * code that outlived a relaunch would just be a stale join waiting to surprise
 * someone.
 */
let pendingCode: string | null = null;

export function stashPendingJoin(code: string): void {
  pendingCode = code;
}

/** Reads and clears in one go, so a code is never spent twice. */
export function takePendingJoin(): string | null {
  const code = pendingCode;
  pendingCode = null;
  return code;
}
