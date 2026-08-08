# SpendWise — personal spending monitor (PWA)

React + Vite PWA that monitors and analyses spending from parsed invoices/receipts.
Data lives in Supabase (`life-compass` project, isolated `spend_*` tables) and syncs across devices.
Installable on iPhone/Android/desktop from the browser (Add to Home Screen).

## How data gets in

1. **Claude (Cowork) pipeline** — give Claude invoice screenshots/PDFs, or ask it to refresh from Gmail.
   It parses them and inserts rows into `spend_transactions` (duplicates prevented by `source_ref`).
2. **Manual entry** — Transactions tab → “+ Add manual”.

Amounts are stored verbatim in their original currency. Non-SGD amounts are converted **at the ECB
daily reference rate of the transaction date** (Frankfurter API, fetched by the app at runtime, cached
20h). If a rate is unavailable the amount is shown unconverted and excluded from SGD totals — never guessed.

## Features

- Overview: monthly trend (click a bar to focus a month), category & merchant breakdowns, MoM deltas
- Transactions: search / filter / sort, inline category editing, delete, manual add, CSV/JSON export
- Recurring: auto-detects weekly/monthly/quarterly/annual charges from cadence; annualised cost ranking,
  price-change and lapse detection
- Insights: computed only from your own data — MoM movers, projected month, duplicate charges, price rises
- Budgets: per-category monthly limits with progress

## Deploy to GitHub Pages

**Option A — web browser only, no command line (uses the pre-built `docs/` folder):**

1. github.com → New repository → name it `spendwise` (public) → Create.
2. On the repo page: **Add file → Upload files**. Do **not** use the "choose your files"
   link (it cannot take folders) — instead open the unzipped `spendwise` folder on your
   computer, select **everything inside it** (Cmd/Ctrl-A) and **drag the selection into
   the upload area** on the GitHub page. Folder structure is preserved. Commit.
3. Repo → **Settings → Pages → Source: Deploy from a branch → Branch: `main`, Folder: `/docs`** → Save.
4. After ~1 minute the app is at `https://<you>.github.io/spendwise/`.

Note: `.github/` is a hidden folder (macOS Finder: press Cmd+Shift+. to show hidden files).
With Option A it is **not needed** — skip it if it doesn't come along.

**Option B — command line / GitHub Desktop:**

```bash
cd spendwise
git init && git add -A && git commit -m "SpendWise initial"
git remote add origin https://github.com/<you>/spendwise.git
git push -u origin main
```

Then either Settings → Pages → branch `main` + folder `/docs` (uses the committed build),
or Settings → Pages → Source: GitHub Actions (the included workflow rebuilds on every push).

If you change the source later, regenerate the published build with `npx vite build --outDir docs`
(or ask Claude to do it and re-send the zip).

Local dev: `npm install && npm run dev`

## Auth & security

- Sign in with the existing Supabase account (same login as life-compass: koksum@yahoo.com), or use
  “Email me a login link”.
- The anon key in `src/supabase.js` is the *publishable* key — safe to commit. Row Level Security is
  enforced: verified that an anonymous client sees **0 rows** and a signed-in user sees only their own.
- Optional hardening: in Supabase Dashboard → Authentication → Sign In / Up, disable new sign-ups
  (you already have your account; the parsing pipeline writes via the service role).

## Versioning

Per project convention, `APP_VERSION` in `src/App.jsx` is updated to `vYYYY:MM:DD-HH:MM` on every change.
