# Planazo — iOS App Store submission

Everything needed for the 1.0 submission. Assets in this folder are generated —
`pnpm assets:brand` and `pnpm assets:screenshots` rebuild them from the design
system, so never hand-edit the PNGs.

---

## 1. Before you build

| Item | State | Where |
| --- | --- | --- |
| App icon, 1024², no alpha | done | `apps/mobile/assets/icon.png` |
| Splash on paper `#FCF8F4` | done | `apps/mobile/assets/splash-icon.png`, `app.json` |
| 6.9″ screenshots, 1290×2796 | done | `store-assets/screenshots/ios-6.9/` |
| Privacy policy URL | done | `https://planazo.me/privacy` |
| Terms of use URL | done | `https://planazo.me/terms` |
| Support URL | done | `https://planazo.me/support` |
| In-app account deletion | done | Profile → Delete my account |
| In-app privacy policy link | done | Profile → Privacy policy (5.1.1(i)) |
| Report content, block users | done | plan sheet, group → Manage (1.2) |
| Objectionable-content filter at posting | done | `lib/moderation.ts`, every shared free-text field (1.2) |
| Terms with an objectionable-content clause | done | `https://planazo.me/terms` |
| Production Supabase in release builds | done | `eas.json` → `preview` / `production` env |
| iPhone-only (`supportsTablet: false`) | done | `app.json` |
| `ITSAppUsesNonExemptEncryption: false` | done | `app.json` |
| Deploy planazo.me with the new pages | **you** | `/privacy`, `/terms` and `/support` must all be live before submitting — the app links to each of them |
| `planazo://reset-password` on the prod allow-list | **you** | Supabase → Auth → URL Configuration |
| APNs key attached to the Expo project | **you** | `eas credentials` |
| Demo account for App Review | **you** | see §5 |

### Build and submit

```bash
cd apps/mobile
eas build --platform ios --profile production
eas submit --platform ios --latest
```

`appVersionSource: remote` with `autoIncrement` means EAS owns the build
number. Bump the marketing version in `app.json` (`expo.version`) for each
release; leave the build number alone.

---

## 2. App Store Connect metadata

**Name** (30) — `Planazo`

**Subtitle** (30) — `Plans that actually happen`

**Keywords** (100, no spaces after commas)

```
plans,friends,group,rsvp,meetup,poll,dates,availability,hangout,invite,organise,social
```

**Promotional text** (170)

> Put up a plan, set the number of people it needs, and let everyone answer in
> one place. When enough are in, it's on. No more chasing a group chat.

**Description**

> Some plans die in the group chat. Planazo is where they don't.
>
> Put up a plan (a barbecue, five-a-side, a weekend away) and say how many
> people it needs to happen. Everyone answers in one place: in, or can't make
> it. When the minimum is met, the plan is on and everybody knows.
>
> NO DATE YET? NO PROBLEM
> Post the idea without a date and let people tick the days they can do. The
> day the most people can make wins. No forty-message thread to read back.
>
> EVERY PLAN HAS A NUMBER
> Five-a-side needs ten. Dinner needs four. Set the minimum, and optionally a
> cap, and Planazo tracks it for you, so nobody has to count the yeses.
>
> YOUR GROUPS, NOT A FEED
> Planazo is only the people you invited. There is no discovery, no follower
> count, no algorithm. Groups are private and invite-only.
>
> QUIET BY DEFAULT
> One notification when a plan needs you, and one when it's confirmed. That's
> it.
>
> No ads. No tracking. No selling your data. Read the policy at
> planazo.me/privacy.

**Support URL** — `https://planazo.me/support`
**Marketing URL** — `https://planazo.me`
**Privacy Policy URL** — `https://planazo.me/privacy`

**Category** — Primary: Social Networking. Secondary: Productivity.

**Copyright** — `2026 Planazo`

---

## 3. Privacy nutrition labels

Answer the App Privacy questionnaire like this. Every row is checked against
`supabase/migrations` and `apps/mobile/lib/push.ts` — if the app starts storing
something else, this section changes with it.

**Used to track you: No.** No ad identifiers, no third-party analytics SDKs, no
data shared with data brokers.

| Data type | Collected | Linked to identity | Purpose |
| --- | --- | --- | --- |
| Contact Info → Email Address | Yes | Yes | App Functionality |
| Contact Info → Name | Yes | Yes | App Functionality |
| User Content → Photos or Videos | Yes | Yes | App Functionality |
| User Content → Other User Content | Yes | Yes | App Functionality |
| User Content → Customer Support | Yes | Yes | App Functionality |
| Identifiers → User ID | Yes | Yes | App Functionality |
| Identifiers → Device ID | Yes | Yes | App Functionality |
| Diagnostics → Other Diagnostic Data | Yes | Yes | App Functionality |

Notes for each, if asked:

- **Email** — the sign-in identifier. Never used for marketing.
- **Name** — `profiles.display_name`, the name other members of your groups see.
  Chosen at sign-up, editable at any time.
- **Photos** — only the profile photo you choose, and screenshots you attach to
  feedback. The library is read only at the moment you pick something.
- **Other User Content** — group names, plan titles, descriptions, locations
  you type.
- **Customer Support** — feedback messages you send us, and the reason and note
  on any content you report.
- **User ID** — the account id (`auth.users.id`).
- **Device ID** — the Expo push token, one per device where you turned
  notifications on. Expo's own documentation describes it as identifying the
  recipient device, so it is declared here rather than folded into User ID.
  Cleared when you turn notifications off, and on sign-out.
- **Diagnostics** — app version and device model, attached only to feedback you
  deliberately send.

---

## 4. Age rating

Answer the questionnaire with all "None" — the app has no violence, no mature
themes, no gambling, no unrestricted web access. That lands at **4+**.

One judgement call: Planazo carries user-generated text (plan titles,
descriptions, group names) visible to the invited members of a private group.
Answer **yes** to the UGC question if asked — the moderation in §6 is what
backs that up.

---

## 5. App Review notes

Reviewers cannot get past the sign-in screen without an account, so this field
is not optional.

```
Planazo is invite-only: everything happens inside a private group, so a fresh
account sees an empty state. The demo account below is already in two groups
with live plans.

Demo account
  Email:    review@planazo.me
  Password: <set this before submitting>

What to try
  1. Sign in. The first tab lists the plans waiting on an answer.
  2. Open "…" and tap "I'm in" — the slot bar fills and the status updates.
  3. Open the flexible plan and tick a few dates, then "Send my dates".
  4. Account deletion: tap the avatar (top right) → "Delete my account".
     Please use a throwaway account for this — it is immediate and final.

Moderation (Guideline 1.2)
  - Posting is filtered: slurs and explicit terms are refused in any field
    other members see — plan titles and descriptions, locations, group
    names, display names.
  - Report a plan: open any plan, scroll to the bottom, "Report this plan".
  - Report a group: open a group, Manage, "Report this group".
  - Block someone: open a group, Manage, "Block" beside any member. Their
    plans disappear from your feed immediately. Tap again to undo.
  - The rules are published at planazo.me/terms.

Account deletion is at Profile → Delete my account, per 5.1.1(v).
The privacy policy is reachable in-app at Profile → Privacy policy, per
5.1.1(i).
Planazo signs in with email and password only. There is no third-party or
social login, so Sign in with Apple is not required under 4.8.
```

**Create `review@planazo.me` against production and seed it with two groups and
a few plans before you submit.** Reviewers reject on an empty app.

---

## 6. Known risks

**Guideline 1.2 — user-generated content.** Covered, and worth walking the
reviewer through it. Apple asks a UGC app for four specific things — a
filtering method, a reporting mechanism, a way to block, and published
contact details — and all four exist, plus the terms that back them:

| Apple asks for | Where it is |
| --- | --- |
| A method for filtering objectionable material from being posted | `lib/moderation.ts` (`contentViolation`): every free-text field other members see — plan titles, descriptions, locations, group names, display names — is checked at posting time and refused with a message pointing at the terms. The word list is normalised against lookalike characters (F4GG0T is still caught) and matched on word boundaries, so Scunthorpe keeps its name |
| A mechanism to report offensive content | "Report this plan" on the plan sheet; "Report this group" in group → Manage |
| The ability to block abusive users | group → Manage → **Block** beside any member, and a "Block them too" toggle on the report screen |
| Published contact details | `planazo.me/support` and `hola@planazo.me` |
| Published terms with no tolerance for objectionable content | `planazo.me/terms`, "What you agree not to post" |

Blocking is enforced in the database, not in the client: `has_blocked()` is
part of the plans SELECT policy, so a blocked person's plans stop existing for
you in the feed, in the group and by direct link alike. Every plan
notification honours the block too — new plan, plan confirmed, called off,
back on — because each fan-out skips recipients who have blocked the plan's
creator; otherwise you would get a push about a plan the database then
refuses to show you. Locking a flexible plan also never converts a blocker's
old availability into an RSVP on a plan they can no longer see. It is
one-way and silent — the blocked party is never told, and cannot read the
block row.
Reports are insert-only for the reporter, so nobody can discover who reported
them. Triage happens off the service role.

Two deliberate limits, in case Review asks:
- Blocking does not eject anybody from a group. Removing a member is an
  admin's decision; blocking is a personal one, and a personal choice should
  not silently reshape the group for everyone else.
- The filter is a word list — slurs and explicit terms — not machine-learning
  moderation. Content here is only ever visible to the invited members of a
  private group — no discovery, no public feed, no strangers — so beyond the
  filter, moderation is report-driven, with a committed 24-hour response
  written into the terms.

**Guideline 5.1.1(i) — privacy policy in the app.** Covered: Profile → Privacy
policy, next to Terms of use and Help & support, all three opening
`planazo.me`. The store-listing URL alone is not enough.

**Guideline 5.1.1(v) — account deletion.** Covered. Deleting is immediate and
hands groups over rather than destroying them; the behaviour is written out in
the privacy policy so the reviewer can check the claim.

**Screenshots must match the shipping build.** The gallery is composed from the
real components with the app's real copy, but if any of that changes before
submission, re-run `pnpm assets:screenshots`.

---

## 7. Not done, on purpose

- **Android / Play Store.** The adaptive icon and its `#F2542D` background are
  generated and correct, but nothing else here targets Play.
- **Localisation.** The app is English; planazo.me still renders Spanish
  (`LANG` in `apps/web/lib/copy.ts`), and the legal pages follow it. The store
  listing above is English. Worth deciding before launch.
