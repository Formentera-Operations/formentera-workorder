---
title: "feat: Retool to workorder app cutover"
type: feat
status: active
date: 2026-05-18
origin: docs/brainstorms/2026-05-18-retool-cutover-requirements.md
---

# feat: Retool to workorder app cutover

## Summary

A six-unit operational + technical plan that delivers the June 10, 2026 cutover from Retool to the Next.js workorder app: today's announcement email and Teams channel setup, a three-week presentation demo program (with session #1 recorded), the June 8 Intune Web Clip push, and the June 10 cutover execution itself (Retool stop-work signal, Supabase backup, data + photo migration script re-runs, verification, day-1 monitoring). All technical work reuses existing scripts; no new app code is added.

---

## Problem Frame

The June 10 hard cutover for ~90 foremen and lease operators arrives in roughly three weeks. The brainstorm settled the WHAT (see [docs/brainstorms/2026-05-18-retool-cutover-requirements.md](docs/brainstorms/2026-05-18-retool-cutover-requirements.md)); the open question entering planning was HOW — specifically, what sequence of operational and technical steps lands the cutover safely, and which existing infrastructure each step leans on. Phase 1 research confirmed: auth is Microsoft SSO via Azure AD, asset filtering reads from a pre-populated `employees` table on login, email infrastructure exists via Microsoft Graph, and the May 15 rehearsal proved the migration scripts work end-to-end.

---

## Requirements

Carried forward from origin (see [docs/brainstorms/2026-05-18-retool-cutover-requirements.md](docs/brainstorms/2026-05-18-retool-cutover-requirements.md)):

- R1–R5. Announcement email today from Alex with the demo schedule, the two user-visible changes, the Teams channel, and the path to request asset access.
- R6–R8. Demo program May 20 → June 9 (virtual, presentation-style, drop-in), with session #1 recorded.
- R9. iPhone Web Clip pushed via Intune on June 8 with email-only "don't use yet" gate.
- R10. Cutover June 10 afternoon: revoke Retool, re-run `scripts/migrate-from-retool.mjs`.
- R11. Microsoft Teams support channel stood up before the email goes out.
- R12. Asset-filter change called out in email, demonstrated in every demo, resolvable post-cutover in the support channel within one business day.

**Origin actors:** A1 (Alex), A2 (Foremen), A3 (Lease operators), A4 (Workorder support Teams channel).
**Origin flows:** F1 (Announcement and demo discovery), F2 (Demo attendance), F3 (Cutover execution), F4 (Day-1 support and asset-access requests).
**Origin acceptance examples:** AE1 (R3, R12 — missing well resolved via channel), AE2 (R6, R8 — recording covers missed sessions), AE3 (R10 — data delta verified), AE4 (R9 — email-only gate accepted).

---

## Scope Boundaries

Carried from origin:

- No in-app onboarding (tour, tooltips, banners) — training relies on demos + email.
- No recording beyond session #1.
- No hands-on user practice before June 10; Web Clip lands June 8 but use is blocked by email guidance only.
- No role-differentiated communication.
- No app feature changes; no new code shipped as part of the cutover.
- No SMS, no in-Retool banner, no reminder emails.
- No mandatory attendance tracking or per-user demo assignment.
- No technical enforcement of the June 8–10 use-block (auth + populated `employees` table mean Microsoft SSO sign-in succeeds; behavioral risk accepted).

### Deferred to Follow-Up Work

- Lessons-learned writeup and any onboarding improvements identified during day-1 support (post-cutover, separate planning cycle).
- Retool account deletion: defer until cutover + 1 week of clean operation; not part of this plan.

---

## Context & Research

### Relevant Code and Patterns

- [scripts/migrate-from-retool.mjs](scripts/migrate-from-retool.mjs) — Reusable data migration script. Validated end-to-end by May 15 rehearsal (9,427 rows). Idempotent because it wipes + reloads via a service-role key; re-running on June 10 picks up the May 15 → June 10 delta by exporting fresh CSVs first.
- [scripts/migrate-images-to-supabase.mjs](scripts/migrate-images-to-supabase.mjs) — Companion photo migration. Always runs AFTER the data migration (the wipe resets photo URLs back to whatever's in the CSV). Idempotent via `isOurSupabaseUrl` skip and `upsert: true` on storage writes.
- [components/AuthProvider.tsx](components/AuthProvider.tsx) — Loads `role` + `assets` from the `employees` table (matched by `work_email`) on every sign-in. This is the asset-filter gate; the `employees` table is already populated for all 90 users.
- [lib/mailer.ts](lib/mailer.ts) — Existing Microsoft Graph email sender (uses `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_SENDER_EMAIL` envs). Not used by this plan — announcement is sent from Alex's Outlook personally. Documented here in case future cohort emails want it.
- [app/login/page.tsx](app/login/page.tsx) — Microsoft SSO ("Sign in with Microsoft") is the primary login path; users sign in with `@formenteraops.com` credentials they already have for Outlook/Teams. The page includes a built-in help modal with step-by-step sign-in instructions (worth referencing in the email).

### Institutional Learnings

- May 15 rehearsal procedure (see memory `project_retool_supabase_migration`): export 5 CSVs from Retool first, run script in dry-run mode (validates row counts, aborts on bad rows), then `--commit` mode (wipes + reloads), paste regenerated `migrations/post_retool_load_sequence_bump.sql` into the Supabase SQL editor, re-run image migration, spot-check tickets.
- Image migration is known to surface a transient single-photo network error during the commit pass; plan for a second `--commit` run to pick up stragglers, then a final dry-run to confirm `Rows touched: 0`.
- Supabase SQL editor only shows the LAST statement's result when pasting multi-statement SQL — sequence-bump verification should use `UNION ALL` if explicit per-table confirmation is needed.

### External References

None gathered — the work is operational + reuses well-rehearsed scripts. No new external best-practices research warranted.

---

## Key Technical Decisions

- **Send announcement email from Alex's Outlook personally**, not via `lib/mailer.ts`. Rationale: one-off broadcast to a known recipient list, plus reply-to behavior is simpler (replies land in Alex's inbox naturally). The `lib/mailer.ts` path remains available for future cohort emails.
- **Photo migration runs as a mandatory step on cutover night**, immediately after the data migration. Rationale: matches the May 15 rehearsal sequence; protects any Retool-hosted photos added to existing or new tickets between May 15 and June 10. Skipping it on a "no new photos" assumption is brittle — the script is idempotent and safe to run.
- **Take a Supabase database snapshot immediately before the data migration script's `--commit` run**, even though the script is recoverable. Rationale: cheap insurance against a verification failure that would otherwise force re-export-and-rerun under time pressure. Retool data remains accessible as a secondary fallback.
- **Recording of demo session #1 is hosted as a file in the Teams support channel**, linked from a pinned post. Rationale: every user is already in the channel by then; no second login or location to discover.
- **Stop-work signal at T-30 minutes before the Retool disable**, broadcast via the Teams support channel. Rationale: gives field users a chance to finish any in-progress Retool ticket before the migration window. Matches the May 15 rehearsal's "submit forms disabled first" approach.

---

## Open Questions

### Resolved During Planning

- **Use-block enforcement during June 8–10**: Accepted as email-only (no code gate). See AE4 in origin doc.
- **Email "From" identity**: Alex personally (alejandro.benavides@formenteraops.com).
- **Support surface**: Microsoft Teams channel (singular, handles both questions and asset-access requests).
- **`employees` table state**: confirmed pre-populated for all 90 users — no provisioning workstream needed.
- **Email send mechanism**: Outlook manually (see Key Technical Decisions).
- **Photo migration on cutover night**: mandatory immediately after data migration (see Key Technical Decisions).
- **Backup posture**: take a Supabase snapshot pre-cutover (see Key Technical Decisions).

### Deferred to Implementation

- Exact wording of the announcement email (draft during U1, not in plan).
- Exact wording of the asset-access request template in the Teams channel pinned post (draft during U2).
- Whether session #1's recording also needs an edited/trimmed version, or the raw Teams recording is fine (decide after U3's session).
- Whether the Retool workspace should be downgraded to read-only vs. fully revoked at T-0 (decide during U5; read-only is safer if any post-cutover data forensics are needed).

---

## Implementation Units

### U1. Send announcement email (May 18)

**Goal:** Get the cutover announcement, demo schedule, and two key behavioral changes in front of all 90 foremen and lease operators today, so the first demo on May 20 has an informed audience.

**Requirements:** R1, R2, R3, R4, R5, R12.

**Dependencies:** U2 must at least have the Teams channel name finalized so it can be linked in the email. In practice, U1 and U2 run interleaved today.

**Files:**
- None (composed and sent from Outlook).

**Approach:**
- Compose in Outlook. Single email, BCC the 90 recipients (so reply-all doesn't blast everyone). Subject names the date and the change so it survives mailbox triage.
- Body covers, in order: (1) what's happening and when (June 10 hard cutover); (2) the two user-visible changes (assets filtered by assignment + true desktop view); (3) the demo schedule with the Teams join link; (4) the recording note (session #1 will be recorded for anyone who can't make a live session); (5) the support channel link with the line about requesting missing asset access; (6) the explicit "do not use the app before June 10 even if you see the icon" instruction.
- Link the in-app help modal from [app/login/page.tsx](app/login/page.tsx) by paraphrasing its sign-in steps — Microsoft SSO, approve in Outlook mobile, "Stay signed in" → yes.
- Pull the recipient list from the `employees` table — `work_email` for everyone with the relevant `job_title`s (Foreman, Superintendent, Lease Operator). Verify list count is ~90 before sending.

**Patterns to follow:**
- The login help modal copy in [app/login/page.tsx](app/login/page.tsx) (lines roughly 162–215) is a ready-made sign-in walkthrough — extract the steps into the email body so users have a written reference.

**Test scenarios:**
- Happy path — send a test version of the email to Alex's own address first, render-check on iPhone Mail (the primary client for field users). All links, including the Teams join link and channel link, resolve correctly on tap.
- Edge case — confirm BCC field is used (not To/CC), so reply-all isn't possible.
- Verification of recipient count — query `employees` for foremen/superintendents/lease operators and compare against the BCC list before send. Expect ~90; flag if dramatically different.

**Verification:**
- Email is sent before end of day May 18, 2026.
- Test send to Alex renders correctly on iPhone.
- Final BCC count matches a fresh count from the `employees` table (within tolerance for any temp-bench employees).

---

### U2. Stand up Teams support channel and prepare demo materials (May 18–19)

**Goal:** Create the Microsoft Teams channel referenced in the email, add all 90 users, pin the cutover info post, and prepare the demo deck/script that session #1 will record on May 20.

**Requirements:** R11 (Teams channel), R6/R7 (demo program scaffolding), R12 (asset-access request path).

**Dependencies:** None — runs interleaved with U1 today.

**Files:**
- None (Teams setup is in the Teams admin UI; demo deck lives in PowerPoint/Loop or similar).

**Approach:**
- Create a dedicated Teams channel (suggested name: `#workorder-rollout` or similar — pick one that's clearly tied to the cutover so it doesn't get confused with future operations channels).
- Add all 90 users via a distribution group or batch add. Confirm membership reaches ~90.
- Pin a top post with: (a) cutover-date reminder, (b) demo schedule + Teams join link, (c) the asset-access request template ("If you're missing an asset on June 11, post here with: your name, asset name, well/lease, and a screenshot of what you're seeing — I'll update access same-day"), (d) where the session #1 recording will land (this same channel, posted as a file after May 20).
- Prepare the demo deck/script. Cover: (1) sign-in walkthrough mirroring the login help modal, (2) the standard ticket-creation flow end to end, (3) explicit "here's what's different from Retool" section — asset filtering shown live (logged in as a real foreman to demonstrate the filter), and the desktop view shown alongside mobile, (4) where to ask questions (the same Teams channel everyone's already in).
- Dry-run the deck once internally before May 20.

**Patterns to follow:**
- Existing Teams channels in the org for naming and notification-setting conventions.

**Test scenarios:**
- Test expectation: none — operational setup, no behavioral code changes.

**Verification:**
- Teams channel exists with ~90 members and a pinned cutover info post by May 19 end of day.
- Demo deck completes a full dry-run with all flows working on a test account before May 20 8am.

---

### U3. Execute demo program and record session #1 (May 20 – June 9)

**Goal:** Deliver 27 presentation-style demo sessions on the schedule from the email, record session #1, and post the recording to the Teams channel so anyone who can't attend a live session has access.

**Requirements:** R6 (schedule), R7 (presentation-style), R8 (recording session #1), R12 (asset-filter demonstration in every session).

**Dependencies:** U1 (email sent so users know to attend), U2 (Teams channel exists, deck ready).

**Files:**
- None.

**Approach:**
- Run sessions on the schedule: Mon–Thu 8–9am and 2–3pm, Fri 8–9am only. Use the same Teams meeting link the email references.
- For session #1 (May 20, 8am): enable Teams cloud recording at the start. After the session, download the recording, post it to the Teams channel as a file, and update the pinned post with a link.
- Across all sessions, demonstrate the asset-filter behavior live (sign in as a real foreman, show the filtered well list, sign back in to demo it again as a different user with a different asset set) so users see what the change looks like in the actual UI.
- Take notes after each session on questions that came up. Themes that repeat across sessions go into a "FAQ" reply on the pinned post.

**Patterns to follow:**
- None.

**Test scenarios:**
- Happy path — session #1 recording downloads cleanly from Teams, plays back, and the asset-filter demo segment is visible.
- Edge case — verify the recording is visible to all 90 channel members (not restricted to the meeting attendees only).
- Verification — pinned post is updated with the recording link within 24 hours of session #1.

**Verification:**
- Recording is posted to the Teams channel by end of day May 21.
- All scheduled sessions run unless explicitly cancelled with a channel-posted reason.
- An FAQ pattern emerges in the pinned post by week 2 (May 27ish).

---

### U4. Push iPhone Web Clip via Intune (June 8)

**Goal:** Deliver the workorder app icon to all 90 Intune-managed iPhones two days before cutover, paired with a Teams channel reminder of the "don't use yet" guidance.

**Requirements:** R9 (Web Clip on June 8 with email-only gate).

**Dependencies:** None on prior units; relies on Intune admin access (Alex has this).

**Files:**
- None.

**Approach:**
- Configure the Web Clip in Intune to point at the production app URL with the workorder logo.
- Scope deployment to the same ~90-user group that received the announcement email.
- Schedule the push for the morning of June 8.
- Post a reminder in the Teams support channel: "The app icon is going onto your phone today. Don't tap it yet — wait for our June 10 cutover announcement."
- Spot-check 2–3 representative iPhones (one foreman, one lease operator, one supervisor) over the course of June 8–9 to confirm the icon landed.

**Patterns to follow:**
- Any prior Intune Web Clip / iOS app deployment pattern Alex has used previously at the org.

**Test scenarios:**
- Happy path — Web Clip appears on a test iPhone within Intune's normal sync window on June 8; tapping it opens the app login page in the in-app browser.
- Edge case — confirm the Web Clip uses the right URL (production, not staging) and the right icon asset.
- Verification — Intune dashboard shows successful deployment count near 90 by end of day June 8; failures get manual follow-up.

**Verification:**
- Intune reports ≥85 successful Web Clip installs by end of day June 8.
- The Teams channel reminder is posted on June 8 morning.
- At least 2 spot-checked phones (live, in users' hands) confirm the icon is present and tappable.

---

### U5. Execute June 10 cutover (Retool stop-work → backup → data migration → photo migration → verify)

**Goal:** Cleanly cut from Retool to the new app the afternoon of June 10 — capture all data added to Retool since May 15, verify the load, and confirm the new app is the live system before users return on June 11.

**Requirements:** R9 (cutover date), R10 (script re-run captures delta).

**Dependencies:** U1–U4 complete (users informed, app deployed).

**Files:**
- Run: [scripts/migrate-from-retool.mjs](scripts/migrate-from-retool.mjs)
- Run: [scripts/migrate-images-to-supabase.mjs](scripts/migrate-images-to-supabase.mjs)
- Paste into Supabase SQL editor: `migrations/post_retool_load_sequence_bump.sql` (regenerated by the data migration script)

**Approach:**
- **T-30 min** — Post in Teams channel: "Retool will be disabled at [exact time]. Please finish or save any open ticket within the next 30 minutes."
- **T-0** — Disable Retool submit forms (matches the May 15 rehearsal approach — full revoke can happen later in the week, after spot-check confirms the new app holds the data). This is the ~3-min critical window during which any submitted Retool ticket would be lost; the T-30 warning is what makes that window safe.
- **Snapshot** — Take a Supabase database snapshot via the Supabase dashboard's backup feature. Record the snapshot ID.
- **Export** — Re-export the 5 CSVs from Retool into `retool-export/` (filenames must start with table prefix per the script's expectations). Five tables: `Maintenance_Form_Submission`, `Dispatch`, `Repairs_Closeout`, `vendor_payment_details`, `comments`.
- **Dry-run** — `node --env-file=.env.local scripts/migrate-from-retool.mjs` (no `--commit`). Confirm row counts look right (expect ~9,427 + delta since May 15) and no rows abort on validation.
- **Commit** — `node --env-file=.env.local scripts/migrate-from-retool.mjs --commit`. This wipes + reloads all 5 tables.
- **Sequence bump** — Open `migrations/post_retool_load_sequence_bump.sql` (regenerated by the script), paste the full contents into the Supabase SQL editor, run. (Editor only shows last statement's result — that's expected.)
- **Photo migration** — `node --env-file=.env.local scripts/migrate-images-to-supabase.mjs --commit`. Expect a transient single-photo network error on the first pass; immediately re-run `--commit` to pick up stragglers, then a final `--commit` dry-run (no `--commit` flag) should report `Rows touched: 0`.
- **Verify** — Open 3–5 tickets in the new app on desktop: at least one created in Retool before May 15, at least one created between May 15 and today, and at least one created today. Confirm description, dates, photos, and assigned foreman render correctly.
- **Close out** — Post in the Teams channel: "Cutover complete. The new app is live. Sign in tomorrow morning and use the channel for any issues."

**Execution note:** Sequence is load-bearing — Retool stop-work → snapshot → data migration → sequence bump → photo migration → verify. Skipping or reordering risks a worse failure mode than running through cleanly.

**Patterns to follow:**
- The May 15 rehearsal sequence documented in memory (`project_retool_supabase_migration`) is the procedure being repeated — every step there applies, plus the pre-cutover Supabase snapshot.

**Test scenarios:**
- Happy path — Covers AE3. After the cutover sequence completes, a ticket created in Retool on, e.g., June 5 is visible in the new app on desktop, with description, dates, and photos intact.
- Happy path — Sign in as a real foreman in the new app on June 10 evening, confirm the asset-filter behavior matches their `employees.assets` array.
- Edge case — A ticket created during the T-30 to T-0 warning window is present in the post-cutover export and gets migrated.
- Error path — Data migration script aborts on a bad row during dry-run. Action: inspect the failing row, decide whether to skip via the script's known mechanisms or fix the CSV and re-export. Do NOT proceed to `--commit` until dry-run is clean.
- Error path — Photo migration's expected transient network error on one photo. Action: re-run `--commit`, confirm clean second pass, then run a final dry-run that should show `Rows touched: 0`.
- Integration — Sequence-bump SQL applied. Create a brand-new ticket in the new app immediately post-cutover (Alex as a test user). The new ticket gets a fresh `id` higher than any imported row, with no sequence conflict.

**Verification:**
- Retool is no longer accepting submissions by T-0.
- Supabase snapshot exists with recorded ID, kept for at least 7 days.
- Data migration script's `--commit` pass loads all 5 tables with row counts matching the dry-run report.
- Sequence bump applied (verified by creating a test ticket in the new app and confirming no conflict).
- Photo migration ends with `Rows touched: 0` on a final dry-run.
- 3–5 spot-checked tickets render correctly across the May 15 boundary.
- "Cutover complete" post lands in the Teams channel before end of evening.

---

### U6. Day-1 support and asset-access triage (June 11 – June 13)

**Goal:** Be visibly present in the Teams support channel for the first 2–3 business days post-cutover so usage questions and asset-access requests get same-day responses, and any data issues are caught quickly while the cutover is fresh.

**Requirements:** R11 (channel as the support surface), R12 (asset-access resolvable through the channel within one business day).

**Dependencies:** U5 complete.

**Files:**
- None directly. Asset-access requests are resolved by updating `employees.assets` for the requesting user via Supabase admin (UI or SQL).

**Approach:**
- Treat the Teams channel as the priority surface for June 11 morning through end of June 13.
- For each asset-access request: ask for asset name + a screenshot of what they're seeing, update the `employees.assets` array for that user via the Supabase dashboard, ask them to sign out and back in (or wait for the next auth refresh) and confirm.
- For usage questions: answer inline, paraphrase repeated questions into a FAQ reply on the pinned post.
- Watch for data-integrity surprises (missing tickets, wrong photos, wrong wells on assigned foremen). For anything that looks structural: pause, check it against the Retool export still in `retool-export/`, and decide whether a targeted fix or a partial re-migration is needed.

**Patterns to follow:**
- Existing AuthProvider behavior in [components/AuthProvider.tsx](components/AuthProvider.tsx) — `assets` change takes effect after the next session refresh, so users may need a sign-out + sign-in to see updated access.

**Test scenarios:**
- Happy path — Covers AE1. A foreman posts "I can't see Well X." Alex queries the wells table to confirm Well X exists, updates the foreman's `employees.assets` to include the asset that owns Well X, asks the foreman to sign out and back in. The foreman reports Well X visible.
- Edge case — A request for an asset that doesn't exist in the wells table (typo or new well). Action: clarify with the user, escalate to whoever owns asset onboarding if it's genuinely a new well.
- Error path — A foreman reports a ticket missing that should have migrated. Action: query the migrated `Maintenance_Form_Submission` table for that ticket's Retool id; if absent, inspect the CSV export to see whether it was in scope; consider a targeted re-insert.

**Verification:**
- Asset-access requests posted June 11–13 are resolved within one business day (no aging tickets in the channel).
- No data-integrity surprises reach end-of-week without a clear resolution path.

---

## System-Wide Impact

- **Interaction graph:** `employees.assets` mutations during U6 directly affect what users see post-login via [components/AuthProvider.tsx](components/AuthProvider.tsx). The change is picked up by the existing auth refresh; no additional cache invalidation is needed because the AuthProvider re-loads from `employees` on every sign-in and the asset list is also cached in localStorage per-user.
- **Error propagation:** The data migration script aborts on validation errors before any writes (per script design). The photo migration is per-row atomic for DB updates, so partial failures leave the row's array untouched. Both behaviors are well-rehearsed.
- **State lifecycle risks:** Between T-30 and T-0, any ticket submitted to Retool falls outside the next CSV export. The 30-minute warning is the mitigation.
- **API surface parity:** None — no API changes are being made in this plan.
- **Integration coverage:** The end-to-end "sign in → see filtered assets → submit ticket" flow is exercised by U5 verification and again by users on June 11. No automated test covers this — coverage relies on the spot-check.
- **Unchanged invariants:** Existing app routes, components, and migration script logic are NOT changed by this plan. The plan executes against the system as it stands today.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Migration script behaves differently on second run (e.g., subtle non-idempotency surfaces). | Dry-run before `--commit` catches structural issues. Supabase snapshot before commit allows recovery. May 15 rehearsal already exercised the wipe-and-reload semantics. |
| Field user attendance at demos is low, leaving users unprepared on June 11. | Session #1 recording posted to the Teams channel is the safety net. The pinned post with FAQ also captures repeated questions over the 3-week window. |
| Curious user taps the Web Clip between June 8 and June 10 and creates a "ticket" that gets overwritten by the cutover migration. | Email guidance + Teams channel reminder on June 8 + accepted soft-gate risk. Behavioral risk for field users is low (they have no reason to abandon Retool early). If it happens, the lost ticket can be re-entered post-cutover by the user. |
| Day-1 support volume overwhelms Alex on June 11. | The Teams channel format (public, threaded) means common questions answer themselves — one resolved thread serves the next 5 users with the same question. The FAQ in the pinned post compounds this. If volume is genuinely high, recruit a backup triager from the office. |
| `employees.assets` arrays are subtly wrong for some users, surfacing as asset-access requests on June 11. | This is the expected steady-state load of U6, not a bug. The channel + Supabase admin loop resolves each within a business day. |
| Photo migration's transient network error compounds into multiple stragglers. | Re-run `--commit` until a final dry-run reports `Rows touched: 0`. Documented in memory. |
| Retool data needed for post-cutover forensics after Retool access is revoked. | Keep Retool workspace in read-only state (not fully deleted) for at least 1 week post-cutover. Full deletion is deferred (see Scope Boundaries / Deferred). |
| Supabase snapshot is needed but Supabase's backup mechanism has a recovery time that's too slow during cutover night. | Snapshot is insurance, not a fast-rollback. If verification fails badly, the practical fallback is to re-export Retool CSVs and re-run the migration script rather than restoring from snapshot. |

---

## Documentation / Operational Notes

- Update the `project_retool_supabase_migration` memory file post-cutover with the actual June 10 row counts and any new lessons learned.
- Update the `project_retool_cutover_plan` memory file to mark the cutover complete and link to any post-mortem notes.
- Consider creating a `docs/solutions/` entry capturing what changed between the May 15 rehearsal and the June 10 cutover, especially anything that would matter for a future migration of similar shape.
- Retool workspace remains in read-only state for 1 week minimum post-cutover; full deletion handled separately.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-18-retool-cutover-requirements.md](docs/brainstorms/2026-05-18-retool-cutover-requirements.md)
- Auth + asset filter: [components/AuthProvider.tsx](components/AuthProvider.tsx), [middleware.ts](middleware.ts), [app/login/page.tsx](app/login/page.tsx)
- Migration scripts: [scripts/migrate-from-retool.mjs](scripts/migrate-from-retool.mjs), [scripts/migrate-images-to-supabase.mjs](scripts/migrate-images-to-supabase.mjs)
- Email infrastructure (not used here, referenced for completeness): [lib/mailer.ts](lib/mailer.ts), [app/api/test-email/route.ts](app/api/test-email/route.ts)
- Memory notes used: `project_retool_supabase_migration`, `project_image_migration_script`, `project_iphone_mdm_intune`, `project_ios_only_field_users`.
