# Dev Environment Playbook — Supabase + Vercel apps

A repeatable process for giving a **production** Next.js app (on Vercel, backed by
Supabase) a safe **dev environment**: an isolated database you can test against —
add records, try features — without ever touching live data or the users who
depend on it.

This was written from the real setup of `formentera-workorder`. Replace the
placeholders (`<PROJECT_REF>`, `<DEV_BRANCH_URL>`, etc.) with your app's values.

---

## 0. First decision: do you need schema-in-git?

There are two ways to get a dev database:

| Your situation | Approach | Effort |
|---|---|---|
| **Just experimenting** — a quick sandbox you don't need to keep | Let Supabase **copy the current database structure** into a branch automatically | Low |
| **A live app people depend on** — you want the database structure tracked/repeatable | **Save the structure into migration files** (this playbook) | Medium |

> When asking the user which one they are, use plain language — avoid the jargon
> "production" and "throwaway". e.g. *"Is this a live app people actually depend
> on, or something you're just testing out?"*

Supabase branching can copy your current database structure into a branch on its
own, so if you're just experimenting you may not need the saving step at all. But
for a live app, saving the structure into `supabase/migrations/` gives you
reviewable diffs, disaster recovery, and the "schema changes go through migrations,
not the dashboard" workflow. **For any app people depend on, do the capture.**

Other prerequisites worth checking up front:
- **Which systems does the app *write* to?** Only those need isolating for dev.
  Read-only integrations (e.g. a reporting warehouse, a read-only external API)
  can safely share their production credentials with dev. In our case only
  **Supabase** needed isolation; Snowflake and the AFE API were read-only.
- **How does login work?** Formentera apps all use **Microsoft Entra (Azure) SSO**,
  so the default plan is to wire that to the dev branch so the sandbox mirrors
  production (Phase 4, Option A — needs **Azure App Registration** access). Only if
  you can't reach Azure, fall back to email/password — which requires the app to
  support it.

---

## Phase 1 — Capture the production schema into version control

Goal: get your live schema into `supabase/migrations/` as a file in the repo.

**Do this in a GitHub Codespace — it's the default, not a fallback.** The save
command (`db dump`) needs Docker, and corporate laptops often don't have it (and
can't easily install it). A Codespace is a cloud machine that already has Docker
built in, so the command always works and you skip the "do I have Docker?"
question entirely. Open one on the repo: green **Code** button → **Codespaces** →
**Create codespace on main**. Then, in the Codespace terminal:

```bash
npx supabase init                 # creates supabase/config.toml
mkdir -p supabase/migrations       # ensure the folder exists
npx supabase login                 # authenticate
npx supabase link --project-ref <PROJECT_REF>   # ref = the xxxx in xxxx.supabase.co
npx supabase db dump --linked -f supabase/migrations/<TIMESTAMP>_initial_schema.sql
git add supabase/config.toml supabase/migrations/
git commit -m "Capture production schema as first migration"
git push
```

`db dump` is **read-only** against production — it only reads structure, never
writes. Docker is only needed for these schema commands, never for the running
app. When done, **delete the Codespace** (it bills while it exists).

> Advanced: if you already have Docker Desktop running locally, you can run the
> same commands on your own machine instead — but there's no need to check; just
> default to the Codespace.

### ⚠️ Gotcha: Codespace auth + missing folder
- In a fresh Codespace, `db dump` may report **"Access token not provided"** even
  after `login`. Fix: create a Personal Access Token at
  `supabase.com/dashboard/account/tokens` and `export SUPABASE_ACCESS_TOKEN=sbp_…`
  before running. **Revoke that token when done.** Never paste tokens into chat
  tools or commit them.
- `supabase init` does **not** create `migrations/`. `mkdir -p supabase/migrations`
  first, or the dump fails with "no such file or directory".
- Don't commit `supabase/.temp/` (machine-local state). The default
  `supabase/.gitignore` excludes it; if `.temp` got committed, untrack it with
  `git rm -r --cached supabase/.temp`.

---

## Phase 2 — Enable Supabase Branching + connect GitHub

In the Supabase dashboard: branch dropdown (top bar) → **Create branch** /
**Manage branches** → enable **Branching**, which prompts you to connect GitHub.

Settings:
- **GitHub repository:** your repo
- **Working directory:** `.` (the folder containing `supabase/`; root = `.`)
- **Deploy to production:** ON, production branch = `main` — means merging a PR
  with schema changes into `main` auto-applies them to prod (the intended
  workflow; only schema files trigger it, not code-only changes)
- **Automatic branching:** ON, **"Supabase changes only": ON** — a preview
  database is created only for PRs that change `supabase/` files (keeps cost down)
- **Branch limit:** small (e.g. 3)

> 💲 Branching compute is **not** covered by the org spend cap — each running
> branch bills hourly (~$0.32/day on micro). Delete branches when done.

---

## Phase 3 — Connect Supabase to Vercel (three steps — pace them)

This connects the two systems so Vercel gets Supabase credentials automatically,
and preview deploys get their own per-branch database credentials. It's **three
distinct steps** — do them in order and confirm each before the next, rather than
dumping all of it at once.

### 3a — Install + link the integration, then resync
1. Supabase → Settings → Integrations → **Vercel** → **Install Vercel Integration**.
2. In Vercel, grant the integration access (choose the specific project).
3. Back in Supabase, complete the **project-to-project link** (install ≠ link —
   you must map the Supabase project to the Vercel project for env-var sync).
4. Trigger **Resync environment variables**.

#### ⚠️ Gotcha: "variable already exists" on resync
If you already set Supabase vars in Vercel manually, resync fails:

> `A variable with the name NEXT_PUBLIC_SUPABASE_URL already exists…`

Fix: delete the **manually-created** Supabase vars in Vercel
(`NEXT_PUBLIC_SUPABASE_URL`, `*_ANON_KEY`, `*_SERVICE_ROLE_KEY`), then resync so
the integration manages them. (Safe — Vercel env changes only take effect on the
next deploy; the running app is unaffected during the swap.)

### 3b — Make the app read the new key names
The integration provisions variables under Supabase's **new** key names, which
likely differ from what older app code reads:

| Old name (legacy) | New name (integration provisions) |
|---|---|
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |
| `SUPABASE_SERVICE_ROLE_KEY` | `SUPABASE_SECRET_KEY` |
| `NEXT_PUBLIC_SUPABASE_URL` | (unchanged) |

If your code reads the old names, it breaks on the next deploy. Fix the code to
**read the new name with a fallback to the old** so every environment works:

```ts
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
         ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const secret = process.env.SUPABASE_SECRET_KEY
            ?? process.env.SUPABASE_SERVICE_ROLE_KEY
```

Do this on a branch, verify login works on the **preview deployment**, then merge.
(Note: middleware using `getClaims()` verifies JWTs against the project's signing
keys, not the API key value — so swapping anon→publishable doesn't change login
behavior.)

**Later — retire the fallback (cleanup).** The `?? legacy` is a *transition
bridge*, not permanent. Once **every** environment is on the new names — Vercel
prod + preview (auto), your local `.env.local` (rename the vars; values can stay
the same, Supabase still accepts legacy key values under the new names), and any
scripts — remove the fallback so the code reads only the new names. Do it the same
way: branch → verify login + data load locally *and* on the preview → merge. Order
matters: rename `.env.local` and confirm local works **before** the fallback-free
code reaches your machine, or local dev breaks with `URL and Key are required`.
(Rarely-run utility scripts can keep their own fallback.)

### 3c — Make sure preview builds have the Supabase keys
The integration may sync vars to **Production** scope only. A **code-only** PR
gets a Vercel preview but **no** preview database branch (because of "Supabase
changes only"), so its build has *no* Supabase credentials and fails:

> `Error: supabaseUrl is required.`

Fix: in Vercel → Settings → Environment Variables, edit
`NEXT_PUBLIC_SUPABASE_URL`, the publishable key, and the secret key to also apply
to the **Preview** environment. (Development scope is locked for "Sensitive" vars
but isn't needed — local dev reads `.env.local`, not Vercel.) Note: code-only
previews then talk to the **production** DB — fine for read-only checks, but don't
write test data there.

---

## Phase 4 — Create the dev branch sandbox

1. **Create a persistent branch** (Supabase → branch dropdown → Create branch):
   - Name: `dev`
   - **"Sync with Git branch": leave BLANK** — a standalone, stable sandbox not
     tied to any PR
   - Skip PITR (that's a production-recovery feature, unrelated)
   - The branch builds by cloning the prod schema (status should go **Healthy**).
     This also validates your captured migration replays cleanly.

2. **Confirm what cloned.** Branches clone **schema but not data** — expect the
   tables to be present but **empty**. Verify in the branch's Table Editor.

3. **Seed reference data** (the lookup tables that make the app usable —
   employees, equipment, etc.; leave transactional tables empty for your tests).
   Easiest, no-terminal method: in the dashboard, switch to `main` → Table Editor
   → table → `…` → **Export to CSV**; switch to `dev` → same table → **Import data
   from CSV**. (Watch array/JSON columns — if a CSV import errors, insert that
   table's rows via SQL instead.)

4. **Set up a way to log in to the sandbox.** Default to wiring the app's **real
   login** to the `dev` branch, so the sandbox logs in exactly like production.
   **Formentera apps all use Microsoft Entra (Azure) SSO**, so these steps are
   written concretely for Azure (verified). *(A different provider would follow the
   same shape — just substitute its console.)*

   **Option A — wire Azure (Entra) SSO to the dev branch (default / recommended):**
   You need access to the app's **Azure App Registration**. The sign-in round-trip
   is: app → Microsoft → the **dev branch's** Supabase callback → back to the app,
   so each hop must be allowed.
   1. In Supabase on the **`main`** branch → **Auth → Providers → Azure**, copy the
      **Application (client) ID**, the **Secret**, and the **Azure Tenant URL**.
      (If the secret is masked, create a fresh client secret in Azure in step 4.)
   2. On the **`dev`** branch → **Auth → Providers → Azure**: enable it and paste
      those three values.
   3. On **`dev`** → **Auth → URL Configuration**: set **Site URL** to the local
      address **`npm run dev` prints in your terminal** — usually
      `http://localhost:3000`, but it may be `:3001`/`:3002` if that port is in
      use, so use whatever it actually shows. Add that same address to the
      **Redirect URLs** allow-list (e.g. `http://localhost:3000/**`, plus any
      preview URL).
   4. In the **Azure portal → App registrations →** your app **→ Authentication →
      Redirect URIs**, add the **dev branch's** Supabase callback:
      `https://<DEV_BRANCH_REF>.supabase.co/auth/v1/callback`.
   5. Test: app pointed at `dev` → click **Sign in with Microsoft** → it bounces
      through Microsoft and lands you in the dev sandbox with your real identity.

   **Fallback — only if you can't reach the Azure App Registration:** if the app
   *also* supports **email/password**, on `dev` → Authentication → Users → **Add
   user** → email + password + ✅ **Auto Confirm User**, then sign in via the app's
   email path. (If the app is SSO-only *and* you can't touch Azure, there's no
   shortcut — get Azure App Registration access to do Option A.)

   Use an identity whose **email matches a seeded staff/profile row**, so you get a
   real role + permissions in the sandbox.

5. **Point local dev at the branch.** Back up first, then swap the 3 Supabase
   values in `.env.local` to the **branch's** URL + keys (Supabase → on `dev` →
   Connect / Settings → API Keys):

   ```bash
   cp .env.local .env.local.prod-backup   # so you can flip back to prod
   ```
   ```
   NEXT_PUBLIC_SUPABASE_URL=<DEV_BRANCH_URL>
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<dev branch anon/publishable key>
   SUPABASE_SERVICE_ROLE_KEY=<dev branch service_role/secret key>
   ```
   Restart `npm run dev` (env changes only load at startup). Log in with the test
   user → you're on the isolated dev DB.

> A brief flash of *old* data on first load is the app's localStorage snapshot
> from a previous prod session — it revalidates to the real (empty) dev data.
> Clear site data in DevTools to stop the flash.

---

## Phase 5 — Local environment gotchas

### `.env.local` only contains what *you* put in it
Production reads env vars from **Vercel's** encrypted store; local reads
`.env.local`. They're **separate lists**. Variables that only ever lived in Vercel
(e.g. warehouse/external-API creds) won't exist locally until you copy them in.
That's why a feature can work in prod but be blank locally. To enable it locally,
copy those values from Vercel (Settings → Environment Variables) into `.env.local`.
**Sensitive** Vercel vars can't be revealed — get those from their original source.

### Trust the code, not the `.example`, for which vars are real
`*.example` files drift. Check the actual connection code for the variables and
auth method it uses. (We found `SNOWFLAKE_PASSWORD` listed in the example but the
code used **key-pair / JWT auth** with `SNOWFLAKE_PRIVATE_KEY` — the password was
never used.) Keep `.env.local.example` accurate as a side effect.

### Multi-line secrets (e.g. private keys) in `.env.local`
Either put it on **one line with literal `\n`**, or keep it **multi-line wrapped in
double quotes**. A bare multi-line value (no quotes) only reads the first line.

### Secrets & rotation
A secret in `.env.local` is safe and needs **no rotation** — the file is gitignored
and never leaves your machine. You only rotate if a secret actually *leaks*
(committed to git, pasted into chat/logs, lost laptop).
- Confirm `.env.local` is gitignored.
- Also ignore **backups**: `.env.local.*` doesn't match the default `.env.local`
  rule. Add `.env.local.*` (and `!.env.local.example` to keep the template
  tracked) so files like `.env.local.prod-backup` can't be committed.

---

## Phase 6 — Reconcile migration history (one-time)

If the production DB was originally built **by hand** (dashboard / import scripts)
rather than through migrations, its migration *ledger* won't match your captured
file. After enabling branching, pushes to `main` then fail the **Supabase
Preview** check with:

> `Remote migration versions not found in local migrations directory.`

This is **bookkeeping only** — it doesn't affect prod data, the dev branch, or
local dev — but fix it before doing schema-change PRs.

```bash
npx supabase migration list --linked     # see the mismatch (no Docker needed)
```
Example output — local file not registered, and a branching-created baseline with
no local file:
```
 Local          | Remote
 <YOUR_VERSION>  |
                | <BRANCHING_BASELINE>
```
Reconcile so the ledger matches your local file (repair edits ONLY the
`supabase_migrations` table — no DDL, no data change):
```bash
npx supabase migration repair <BRANCHING_BASELINE> --status reverted
npx supabase migration repair <YOUR_VERSION> --status applied
npx supabase migration list --linked      # both columns should now match
```

### ⚠️ Gotchas
- A transient `wsarecv: connection aborted` on the first repair is usually just a
  network blip — **retry**. (If it persists, set `SUPABASE_DB_PASSWORD`.)
- GitHub's **"Re-run"** button does **not** reliably re-trigger Supabase's
  external check (the timestamp stays stale). To verify the fix, push a fresh
  (even empty) commit to `main`:
  ```bash
  git commit --allow-empty -m "Trigger Supabase check" && git push
  ```
  The new commit's Supabase Preview check should go green.

---

## Day-to-day workflow after setup

- **Code-only change** → branch → PR → Vercel preview → merge. No DB involvement.
- **Schema change** → branch → create a Supabase branch → make the change there
  (recorded as a migration file) → PR → preview (isolated branch DB) → merge
  (migration auto-applies to prod). **Never hand-edit the prod DB in the Table
  Editor** — that reintroduces the Phase 6 drift.
- **Local testing** → `.env.local` points at the `dev` branch; add test data
  freely — it's invisible to production.

## Cost & cleanup
- Each running branch bills hourly and is **outside** the spend cap. Delete
  branches you're not using.
- Delete Codespaces after schema-capture work.
- `npm run dev` is slow vs. production by design (on-demand compile, small branch
  compute, laptop→cloud latency) — not a production indicator. Use
  `npm run build && npm start` for a faster local feel.

## Quick gotcha index
1. Do Phase 1 in a **Codespace** by default (it has Docker; laptops often don't).
2. Codespace auth → `SUPABASE_ACCESS_TOKEN` (then revoke); `mkdir` migrations first.
3. Resync conflict → delete manual Supabase vars first.
4. Integration uses **new key names** → read-new-fallback-to-old in code; retire
   the fallback later once all envs (Vercel, local `.env.local`, scripts) are on
   the new names (rename `.env.local` first, or local dev breaks).
5. Vars sync to **Production scope only** → add **Preview** scope.
6. `.env.local` ≠ Vercel store → copy needed vars in locally.
7. Trust connection code over `.example` for var names/auth (key-pair vs password).
8. Multi-line secrets → quote them or single-line with `\n`.
9. Ignore `.env.local.*` backups (keep `.example`).
10. Migration ledger drift → `migration list` + `migration repair`; verify with a fresh commit.
