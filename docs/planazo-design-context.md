# Planazo Design Context

Planazo is a mobile app for planning casual events with friends. The core idea is simple: people belong to circles, create plans inside those circles, and everyone can quickly say whether they can make it.

The app is especially useful when a group wants to do something together but the exact date is uncertain. Instead of long chat threads, Planazo lets someone propose either a fixed-date event or a flexible-date event with multiple possible dates. Friends respond with RSVPs or availability, and the app highlights which plans need the user's response and which plans are confirmed.

## Product Model

- Circles: friend groups such as "Weekend Crew", "Food & Drinks", or "Outdoors Club".
- Events / plans: activities created inside a circle.
- Fixed-date plans: one specific date, with yes/no RSVPs.
- Flexible-date plans: multiple possible dates, where people mark the dates they can attend.
- Minimum people: each plan has a required number of people before it feels confirmed.
- Home feed: shows plans that need the user's response and upcoming confirmed plans.

## Why It Helps

Planning with friends usually fails because responses are scattered across messages, people forget to reply, and the group cannot quickly see which date works best. Planazo turns that into a structured flow:

- A plan has one clear place to live.
- Everyone sees the same status.
- Flexible dates make coordination less awkward.
- The "Needs Your Response" section tells the user exactly what to act on.
- Circles keep plans scoped to the right people.

## Design Direction

Planazo should feel social, lightweight, and useful, not corporate. It is closer to a friendly planning utility than a productivity dashboard. The UI should make it easy to scan what is happening, understand whether a plan is confirmed, and respond quickly.

Visual direction:

- Warm, energetic, friendly.
- Orange is the current primary brand color.
- Prioritize clarity over decoration.
- Use compact cards for plans and circles.
- Make response actions obvious and quick.
- Flexible-date selection should feel calendar-first and low friction.

## Key Screens

### Home

The Home screen is the user's command center. It separates pending response work from confirmed upcoming plans.

![Home screen](home.png)

### Circles

The Groups / Circles screen shows the user's social groups and gives access to creating or joining a circle.

![Circles screen](groups.png)

### Circle Detail

A circle detail page lists confirmed, open, and cancelled plans for that specific friend group. This is currently the main entry point for creating a new event.

![Circle detail](group.png)

### Create Fixed-Date Event

Fixed-date creation is for events with a known date. The user enters title, description, location, date, and attendance limits.

![Create fixed-date event](event-create-fixed.png)

### Create Flexible-Date Event

Flexible-date creation is for plans where the date is still being negotiated. The user selects multiple possible dates from a calendar.

![Create flexible-date event](event-create-flexible.png)

### Plan Detail: Confirmed

Confirmed plan detail should make the status obvious and show who is attending or which date won.

![Confirmed plan](plan-confirmed.png)

### Plan Detail: Open / Needs Response

Open plans should make it clear what action the user needs to take, especially for flexible-date availability.

![Open plan](plan-open.png)

### Profile

Profile is lightweight account management: avatar, display name, sign out, and basic app identity.

![Profile screen](profile.png)

## Current Opportunities

- Make navigation and spacing more consistent.
- Add stronger visual hierarchy between confirmed plans and pending plans.
- Improve top navigation styling.
- Add group images.
- Add event photo albums so each event can collect shared photos.
- Support event creation from Home, with group selection.
- Eventually support groupless events and friends.

## Design Tool Prompt Summary

Design a polished mobile UI for Planazo, a friend-group event planning app. It helps people create fixed-date or flexible-date events inside circles, collect RSVPs and availability, and quickly see what needs their response. The experience should feel warm, social, fast, and practical. Use the attached screenshots as the current product baseline, then improve clarity, spacing, navigation, visual hierarchy, and event response flows while keeping the product lightweight and friendly.
