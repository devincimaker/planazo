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
| Support URL | done | `https://planazo.me/support` |
| In-app account deletion | done | Profile → Delete my account |
| Production Supabase in release builds | done | `eas.json` → `preview` / `production` env |
| iPhone-only (`supportsTablet: false`) | done | `app.json` |
| `ITSAppUsesNonExemptEncryption: false` | done | `app.json` |
| Deploy planazo.me with the new pages | **you** | the two URLs must be live before submitting |
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
> Put up a plan — a barbecue, five-a-side, a weekend away — and say how many
> people it needs to happen. Everyone answers in one place: in, or can't make
> it. When the minimum is met, the plan is on and everybody knows.
>
> NO DATE YET? NO PROBLEM
> Post the idea without a date and let people tick the days they can do. The
> day the most people can make wins. No forty-message thread to read back.
>
> EVERY PLAN HAS A NUMBER
> Five-a-side needs ten. Dinner needs four. Set the minimum, and optionally a
> cap, and Planazo tracks it for you — so nobody has to count the yeses.
>
> YOUR GROUPS, NOT A FEED
> Planazo is only the people you invited. There is no discovery, no follower
> count, no algorithm. Groups are private and invite-only.
>
> QUIET BY DEFAULT
> One notification when a plan needs you, and one when it's confirmed. That's
> it.
>
> No ads. No tracking. No selling your data — read the policy at
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
| User Content → Photos or Videos | Yes | Yes | App Functionality |
| User Content → Other User Content | Yes | Yes | App Functionality |
| Identifiers → User ID | Yes | Yes | App Functionality |
| Diagnostics → Other Diagnostic Data | Yes | Yes | App Functionality |

Notes for each, if asked:

- **Email** — the sign-in identifier. Never used for marketing.
- **Photos** — only the profile photo you choose, and screenshots you attach to
  feedback. The library is read only at the moment you pick something.
- **Other User Content** — group names, plan titles, descriptions, locations
  you type, and feedback messages.
- **User ID** — the account id, plus a push token per device you enabled
  notifications on.
- **Diagnostics** — app version and device model, attached only to feedback you
  deliberately send.

---

## 4. Age rating

Answer the questionnaire with all "None" — the app has no violence, no mature
themes, no gambling, no unrestricted web access. That lands at **4+**.

One judgement call: Planazo carries user-generated text (plan titles,
descriptions, group names) visible to the invited members of a private group.

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

Account deletion is at Profile → Delete my account, per 5.1.1(v).
Planazo signs in with email and password only. There is no third-party or
social login, so Sign in with Apple is not required under 4.8.
```

**Create `review@planazo.me` against production and seed it with two groups and
a few plans before you submit.** Reviewers reject on an empty app.

---

## 6. Known risks

**Guideline 1.2 — user-generated content.** Plan and group names are free text.
Apple usually accepts this where content is confined to a private, invite-only
group, which is the case here. If Review pushes back, the cheapest answer is a
"Report this plan" row on the plan sheet that emails `hola@planazo.me`, plus a
line in the group screen making "Leave group" read as the block. Worth having
designed in advance rather than under a 24-hour clock.

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
- **Terms of use.** Apple's standard EULA applies unless we supply our own; the
  footer slot went to Support, which Apple does require.
- **Localisation.** The app is English; planazo.me still renders Spanish
  (`LANG` in `apps/web/lib/copy.ts`), and the legal pages follow it. The store
  listing above is English. Worth deciding before launch.
