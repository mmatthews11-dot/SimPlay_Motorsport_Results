# Sim Racing Results Tower (ACC + LMU)

One dashboard, two fully independent sync pipelines — each with its own data
file, so they can never conflict with each other no matter how their
schedules overlap. A top-level ACC/LMU selector on the page switches between
them, fetching both files and merging them client-side.

## Why two separate files

An earlier version had both syncs writing to one shared `data/results.json`.
That caused a real problem: if both workflows happened to run around the
same time (which became likely once the LMU sync's first-ever run took a
long time to complete, pulling a whole season's history), git would see two
commits touching the same file and could fail to merge them — one sync's
results would simply fail to push. Splitting into two separate files removes
the possibility of that entirely: each workflow only ever touches its own
file, so there's nothing to conflict over.

| | ACC | LMU |
|---|---|---|
| Sync script | `scripts/sync-from-gportal.mjs` | `scripts/sync-from-simgrid.mjs` |
| Workflow | `.github/workflows/sync-acc-results.yml` | `.github/workflows/sync-lmu-results.yml` |
| Data file | `data/acc-results.json` | `data/lmu-results.json` |
| "Already seen" manifest | `processedFiles` | `processedRaces` |
| Source | G-Portal FTP (needs secrets) | Public SimGrid pages (no secrets) |

Each session object still carries a `game: "ACC"` / `game: "LMU"` tag, used
purely by the dashboard to know which rendering logic to use — it's no
longer needed to keep the files from colliding, since they're just separate
files now.

## Setup

### 1. Push this repo, enable GitHub Pages
Settings → Pages → Deploy from a branch → `main` / root.

### 2. ACC: add the G-Portal secrets
Settings → Secrets and variables → Actions → add:
`GPORTAL_HOST`, `GPORTAL_PORT`, `GPORTAL_USERNAME`, `GPORTAL_PASSWORD`,
`GPORTAL_RESULTS_PATH`.

### 3. LMU: check the championship config
Open `scripts/sync-from-simgrid.mjs` and confirm `CHAMPIONSHIP_ID` and the
`CLASSES` list match what you're tracking — class IDs are specific to a
championship/season and change each new one.

### 4. Run both once to test
Actions tab → run "Sync ACC results from G-Portal" and "Sync LMU results
from SimGrid" manually, then check your Pages URL — the ACC/LMU toggle at
the top should show data for each once its sync succeeds.

**Note on the LMU sync's first run**: it has to pull your entire season's
history at once (nothing is in `processedRaces` yet), fetching every
class × session × race sequentially — this can take a while depending on how
responsive SimGrid's pages are. Each individual request now times out after
20 seconds rather than being able to hang indefinitely, so if something goes
wrong it'll fail with a clear error instead of appearing stuck.

## Notes
- LMU results come from scraping public SimGrid pages, not an API — if
  SimGrid redesigns their results page layout, that sync may break and need
  updating. ACC's G-Portal pipeline reads structured files, so it's more
  stable by comparison.
- Qualifying and Race results pages use genuinely different table layouts
  (Qualifying has sector-time columns and no laps/votes columns). The parser
  (`scripts/parse-simgrid-results.mjs`) finds cells semantically (by class
  name, by data attribute) rather than by fixed column position, and is told
  explicitly whether it's parsing a race or qualifying page rather than
  guessing — the leader's row looks identical either way, since neither has
  a "gap" to show.
- There's a minor markup quirk in SimGrid's own page: the leader's Time/Gap
  cell sometimes doesn't close properly, which can nest the next cell's
  unrelated content inside it. The parser works around this by scoping its
  gap-text lookup to the specific `small.text-muted` class the real gap tag
  uses, rather than "any small tag in this cell."
- Penalty points/points aren't tracked, since this championship doesn't use them.
- ACC has a combined "Overall" view across classes (Platinum/Gold/Silver/
  Bronze); LMU does not, since SimGrid doesn't publish one for multi-class
  races — LMU only lets you view one class at a time.
- To force a full re-pull for a game, reset just that game's own file to:
  ```json
  { "sessions": [], "processedFiles": [], "lastSync": null }
  ```
  (or `"processedRaces": []` for the LMU file) — the other game's file is
  completely unaffected either way.
