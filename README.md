# ACC Results Tower

Automatically pulls session result files from your G-Portal ACC server and
displays them on a live-updating webpage — no server of your own required.

## How it works

1. **`scripts/sync-from-gportal.mjs`** connects to your G-Portal server over
   SFTP, finds any result `.json` files it hasn't seen before, parses them,
   and adds them to `data/results.json`.
2. **A GitHub Actions workflow** (`.github/workflows/sync-results.yml`) runs
   that script automatically every 15 minutes and commits the updated data.
3. **`index.html`** is a static page that reads `data/results.json` and
   renders a timing-tower style dashboard. Hosted for free on GitHub Pages.

## One-time setup

### 1. Find your G-Portal SFTP details
In the G-Portal web panel for your ACC server, go to **FTP Access** (G-Portal
has moved to SFTP-only). You need:
- Host
- Port
- Username
- Password
- The path to the results folder — on most ACC servers this is something like
  `/config/results` or `/server/results`. Connect once with an FTP client
  (e.g. FileZilla) to confirm the exact path — it's the folder where files
  named like `250101_190000_FP.json` land after each session.

### 2. Create a GitHub repository
Push this whole folder to a new **public** GitHub repository (Pages'
free tier needs public, unless you have GitHub Pro/Team/Enterprise).

### 3. Add your SFTP details as GitHub secrets
In the repo: **Settings → Secrets and variables → Actions → New repository
secret**. Add each of:
- `GPORTAL_HOST`
- `GPORTAL_PORT`
- `GPORTAL_USERNAME`
- `GPORTAL_PASSWORD`
- `GPORTAL_RESULTS_PATH`

These stay encrypted and are never exposed in the webpage — only the parsed,
already-public race results end up in `data/results.json`.

### 4. Enable GitHub Pages
**Settings → Pages → Source → Deploy from a branch → `main` / root.** Your
dashboard will be live at `https://<your-username>.github.io/<repo-name>/`.

### 5. Run the sync
It runs automatically every 15 minutes, or trigger it immediately from the
**Actions** tab → "Sync ACC results from G-Portal" → **Run workflow**.

## Running it locally instead (optional)
```bash
npm install
GPORTAL_HOST=... GPORTAL_PORT=... GPORTAL_USERNAME=... GPORTAL_PASSWORD=... GPORTAL_RESULTS_PATH=... npm run sync
```
Then open `index.html` in a browser (or run any static file server) to preview.

## What gets pulled in
Only **Qualifying** and **Race** result files are downloaded and added to the
dashboard — Practice (`_FP.json`) files are detected and skipped automatically,
based on the filename suffix ACC uses (`_FP`, `_Q`/`_Q1`/`_Q2`, `_R`/`_R1`/`_R2`).
If you ever want practice sessions included too, remove the `QUALI_OR_RACE`
filter in `scripts/sync-from-gportal.mjs`.

## Notes on the ACC file format
- ACC writes result files as **UTF-16LE**, not UTF-8 — the sync script
  handles that decoding automatically.
- Car model names in `scripts/parse-acc-results.mjs` are a best-effort
  lookup table (Kunos hasn't published one canonical list). If a car shows
  up as "Car #NN", add that ID to the `CAR_MODELS` table.
- Session files are never deleted from `data/results.json`, so the tower
  keeps a full history — the tabs at the top let you switch between
  practice/qualifying/race for each event.

## Customizing
- Change the sync frequency by editing the `cron` line in the workflow file.
- The whole look of the page lives in the `<style>` block in `index.html` —
  colors, fonts, and layout are all in one place.
