# Sim Racing Results Tower (ACC + LMU)

One dashboard, two independent sync pipelines, sharing a single
`data/results.json`. A top-level ACC/LMU selector on the page switches
between them.

## How the two pipelines coexist

Both write to `data/results.json`, but each only ever touches its own part:

| | ACC | LMU |
|---|---|---|
| Sync script | `scripts/sync-from-gportal.mjs` | `scripts/sync-from-simgrid.mjs` |
| Workflow | `.github/workflows/sync-acc-results.yml` | `.github/workflows/sync-lmu-results.yml` |
| Session tag | `game: "ACC"` | `game: "LMU"` |
| "Already seen" manifest | `processedFiles` | `processedRaces` |
| Last sync timestamp | `lastSyncAcc` | `lastSyncLmu` |
| Source | G-Portal FTP (needs secrets) | Public SimGrid pages (no secrets) |

Both workflows do a `git pull --rebase` right before pushing, in case the
other one committed in between — and their schedules are offset (ACC on the
hour/quarter-hour, LMU 7 minutes after) to make simultaneous commits rarer.
This isn't bulletproof, but a rebase conflict here is a rare edge case, not a
data-loss risk — worst case, one workflow's push fails and simply succeeds on
its next scheduled run 15 minutes later.

## Setup

### 1. Push this repo, enable GitHub Pages
Same as before: Settings → Pages → Deploy from branch → `main` / root.

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

## Notes
- LMU results come from scraping public SimGrid pages, not an API — if
  SimGrid redesigns their results page layout, that sync may break and need
  updating. ACC's G-Portal pipeline reads structured files, so it's more
  stable by comparison.
- Qualifying and Race results pages use genuinely different table layouts
  (Qualifying has sector-time columns and no laps/votes columns). The parser
  (`scripts/parse-simgrid-results.mjs`) is written to handle both by finding
  cells semantically (by class name, by data attribute) rather than by fixed
  column position, and is told explicitly whether it's parsing a race or
  qualifying page rather than guessing from the HTML — the leader's row
  looks identical either way, since neither has a "gap" to show.
- There's a minor markup quirk in SimGrid's own page: the leader's Time/Gap
  cell sometimes doesn't close properly, which can nest the next cell's
  unrelated content inside it. The parser works around this by scoping its
  gap-text lookup to the specific `small.text-muted` class the real gap tag
  uses, rather than "any small tag in this cell."
- Penalty points/points aren't tracked, since this championship doesn't use them.
- ACC has a combined "Overall" view across classes (Platinum/Gold/Silver/
  Bronze); LMU does not, since SimGrid doesn't publish one for multi-class
  races — LMU only lets you view one class at a time.
- To force a full re-pull for one game without touching the other's data,
  only clear that game's manifest field (`processedFiles` for ACC,
  `processedRaces` for LMU) and leave the `sessions` array and the other
  game's manifest as they are — new data will simply be added alongside what's
  already there.
