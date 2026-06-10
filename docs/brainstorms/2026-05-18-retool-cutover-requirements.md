---
date: 2026-05-18
topic: retool-cutover
---

# Retool to Workorder App Cutover

## Summary

A June 10, 2026 hard cutover from Retool to the Next.js workorder app for ~90 foremen and lease operators, communicated today via a single email naming the two user-visible behavioral changes and including the schedule for a 3-week virtual demo series; supported on cutover day by a shared Teams channel/inbox and a final data-sync re-run after Retool is turned off.

---

## Problem Frame

Foremen and lease operators have been using the Retool workorder app as their daily system of record. The new Next.js app is already in production on Vercel and the migration script was validated by a May 15 data-sync dry run. Today (May 18) the rollout is roughly three weeks out from cutover with no announcement yet sent, no demo sessions scheduled, and 90 field users who have never seen the new interface. The window to bring them along has narrowed: the first demo needs to land by May 20, every user must internalize the two user-visible behavioral changes (asset filtering by assignment, new desktop view) before June 10, and a post-cutover support shape must be in place before the first user opens the new app cold on June 11.

---

## Actors

- A1. **Alex (rollout owner)**: Sends the announcement email, hosts the demo sessions, runs the cutover (disable Retool, re-run data sync), and staffs day-1 support.
- A2. **Foremen**: Field users who manage crews and lease operators; primary daily users of the workorder app.
- A3. **Lease operators**: Field users assigned to specific assets; record work and updates against their assigned assets.
- A4. **Workorder support Teams channel**: Asynchronous triage surface for cutover questions and asset-access requests. Visible to all 90 users.

---

## Key Flows

- F1. Announcement and demo discovery
  - **Trigger:** Alex sends the announcement email on May 18.
  - **Actors:** A1, A2, A3
  - **Steps:** Alex sends the email with cutover summary, the two key changes, demo schedule, Teams link, and support channel. Recipients open the email and add demo time(s) to their calendar. No RSVP required.
  - **Outcome:** All 90 users have received the schedule and Teams link; they know what is changing and where to ask questions.
  - **Covered by:** R1, R2, R3, R4, R5

- F2. Demo attendance
  - **Trigger:** User joins a scheduled demo via the Teams link.
  - **Actors:** A1, A2, A3
  - **Steps:** Alex presents the new app, walks the standard workorder flow, explicitly demonstrates the asset-filter behavior and the new desktop view, then takes questions. The first session (May 20, 8am) is recorded.
  - **Outcome:** Attendees have seen the app and the two behavioral changes live; questions are surfaced to Alex.
  - **Covered by:** R6, R7, R8

- F3. Cutover execution
  - **Trigger:** Alex begins the cutover the afternoon of June 10 after work hours.
  - **Actors:** A1
  - **Steps:** Alex revokes Retool workspace access, re-runs `scripts/migrate-from-retool.mjs` to pick up the data delta since May 15, verifies row counts and spot-checks, and confirms the new app is the only live system.
  - **Outcome:** Retool is off; new app holds the full dataset; users can log in productively starting June 11.
  - **Covered by:** R9, R10

- F4. Day-1 support and asset-access requests
  - **Trigger:** A user opens the new app on or after June 11 and either has a usage question or cannot see an asset they expect.
  - **Actors:** A1, A2, A3, A4
  - **Steps:** User posts in the shared support channel/inbox. Alex triages, answers usage questions inline, and updates asset assignments when access is missing.
  - **Outcome:** Question resolved or asset assignment updated; the exchange is visible to other users in the channel.
  - **Covered by:** R11, R12

---

## Requirements

**Announcement email**
- R1. The announcement email is sent today (May 18, 2026) from Alex (alejandro.benavides@formenteraops.com) to all ~90 foremen and lease operators.
- R2. The email states the move from Retool to the new workorder app and the June 10, 2026 hard cutover date.
- R3. The email frames the new app as working the same as Retool, then explicitly names the two user-visible differences: (a) users will only see assets they are assigned to, and (b) a true desktop layout is now available (Retool only showed the mobile view on desktop).
- R4. The email includes the full demo schedule and a single Teams link valid for all sessions.
- R5. The email names the shared support/asset-access channel and tells users to use it if they are missing an expected asset.

**Demo program**
- R6. Demos run virtually via Teams from May 20 through June 9, 2026: Mon–Thu 8–9am and 2–3pm, Fri 8–9am only. Open drop-in, no RSVP.
- R7. Demos are presentation-style — Alex shows the app; users do not interact with it during the session.
- R8. The first demo session (May 20, 8am) is recorded and made available as a makeup/reference asset for users who cannot attend any live session.

**Deployment and cutover**
- R9. The iPhone Web Clip is pushed to Intune-managed devices on June 8, 2026, with explicit email guidance not to open the app until after June 10.
- R10. On June 10 afternoon, Alex revokes Retool access and then runs `scripts/migrate-from-retool.mjs` to capture the data delta since May 15.

**Cutover-day and ongoing support**
- R11. A dedicated Microsoft Teams channel is stood up before the May 18 email goes out and named in that email; it serves as both the general support surface and the path to request asset-assignment changes.
- R12. The asset-filter change is covered in the email, demonstrated in every demo, and resolvable post-cutover through the support channel within one business day.

---

## Acceptance Examples

- AE1. **Covers R3, R12.** Given a foreman on June 11 morning who cannot see Well X, when he posts in the support channel, then Alex updates the user's asset assignment and the well appears on next refresh.
- AE2. **Covers R6, R8.** Given a lease operator who cannot attend any of the live sessions, when she opens the announcement email's recording link, then she can watch the May 20 demo on her own time before June 10.
- AE3. **Covers R10.** Given the cutover script run on June 10 evening, when Alex verifies row counts, then all tickets created in Retool between May 15 and June 10 are present in the new app.

- AE4. **Covers R9.** Given a curious user who taps the Web Clip on June 9 (before cutover) and signs in via Microsoft SSO, when they land in the app, then they see the May 15 snapshot data — Alex relies on email guidance, not technical enforcement, to prevent meaningful use during this window.

---

## Success Criteria

- On June 11, the new app is the only live workorder system; no user is blocked from daily work for more than a single business day due to the cutover.
- All 90 foremen and lease operators have either attended at least one live demo or had access to the recording before June 10.
- Day-1 support load is bounded: asset-access requests resolved within one business day; usage questions get same-day responses in the shared channel.
- Post-cutover, the May 15 → June 10 data delta is present in the new app, verified by row counts and spot-checks.

---

## Scope Boundaries

- No in-app onboarding (first-login tour, tooltips, inline banners) — training relies on demos + email.
- No recording beyond the first session, and no replacement of live sessions with recordings.
- No hands-on practice for users before June 10; Web Clip lands June 8 but use is blocked by email guidance.
- No role-differentiated communication — foremen and lease operators receive the same email and the same demos.
- No app feature changes are being made as part of cutover; existing functionality stands.
- No multi-channel comms beyond the announcement email and the Teams support channel (no SMS, no in-Retool banner, no reminder emails).
- No mandatory attendance tracking or per-user demo assignment.
- No technical enforcement preventing app use between June 8 and June 10 — the email's guidance is the only gate.

---

## Key Decisions

- **Hard cutover instead of parallel run.** Single switchover on June 10 rather than coexistence. Rationale: avoids dual-entry confusion and reduces reconciliation work; the May 15 dry run already validated the migration script.
- **Web Clip on June 8 with explicit use-block.** Deploys the icon two days early so devices are ready, while keeping all real activity in Retool until cutover. Rationale: reduces Intune-deployment risk on cutover night without splitting daily activity across systems.
- **Open drop-in demos, no RSVP.** Lowest coordination overhead for both Alex and field users. Trade-off accepted: no attendance roster — mitigated by recording session #1.
- **Record only session #1.** Compromise between user preference for live sessions and the need for a fallback. Rationale: field users like live touchpoints; one recording covers anyone who can't attend any live session.
- **One support surface for both usage questions and asset-access requests.** A single Microsoft Teams channel handles both rather than splitting into separate queues. Rationale: lower friction for users, single triage point for Alex, and a shared self-serve thread of common Q&A visible to all field users.
- **Email sent from Alex personally.** Replies route to Alex's inbox; the email body actively directs users to the Teams channel for support questions. Rationale: personal accountability signal during a high-stakes change; channel handles support load.
- **"Don't use the app before June 10" is enforced by email guidance only.** The auth architecture (Microsoft SSO + pre-populated `employees` table) means any `@formenteraops.com` user with the Web Clip on their phone can technically log in and see real data starting June 8. Rationale: behavioral risk is low (users won't typically jump in early without instruction); adding a code-level gate is not worth the extra change-and-revert effort.

---

## Dependencies / Assumptions

- `scripts/migrate-from-retool.mjs` is idempotent and can re-run on June 10 to pick up the data delta since May 15 without duplicating prior rows. (Validated by the May 15 dry run; assumed to hold on second run.)
- Alex controls Retool workspace access and can revoke it without an IT ticket.
- Intune Web Clip deployment to all 90 field iPhones on June 8 is reliable and requires no user action on the device.
- All ~90 users have a working email address Alex can reach and access to Microsoft Teams.
- The shared support channel/inbox can be stood up before the May 18 email goes out.
- The `employees` Supabase table is already populated for all 90 foremen and lease operators with correct `work_email` and `assets` arrays. The new app uses Microsoft SSO (any `@formenteraops.com` user can sign in) and reads `role` + `assets` from `employees` on login (see [components/AuthProvider.tsx](components/AuthProvider.tsx)).

---

## Outstanding Questions

### Deferred to Planning

- [Affects R10][Technical] Confirm the migration script's behavior on a second run — no duplicate-row risk; the May 15 → June 10 delta is captured correctly; reconciliation steps in case of mismatch.
- [Affects R3, R5][User decision] Exact wording in the email for the asset-filter change and the access-request path. (Draft during email composition, not requirements.)
- [Affects R10][Technical] Whether the photo-migration script (`scripts/migrate-images-to-supabase.mjs`) also needs to re-run on June 10 to capture new photos added to Retool between May 15 and June 10.
