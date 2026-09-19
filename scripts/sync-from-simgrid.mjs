// Discovers new races across one or more SimGrid championships/seasons,
// fetches each class's results for each session, merges them, and updates
// data/lmu-results.json.
//
// This has its OWN dedicated data file, separate from the ACC/G-Portal sync's
// data/acc-results.json — see that script's comments for why they're split.
//
// No login or API token is needed — this reads the same public pages anyone
// can view in a browser. Because of that, this is inherently a bit more
// fragile than an official API: if SimGrid redesigns their results page
// markup, this scraper may need updating to match.

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseRacesPage } from "./parse-races-page.mjs";
import { parseSimGridResultsTable } from "./parse-simgrid-results.mjs";
import { buildSessionSummary } from "./build-session-summary.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "..", "data", "lmu-results.json");

// ---- One entry per championship/season you want tracked ----
// Add a new entry any time a new season starts — nothing needs to be removed
// when a season ends, it'll just stop finding new races for it.
// Class IDs are specific to each championship/season — find them via the
// "Split" filter dropdown on one of that championship's results pages.
const CHAMPIONSHIPS = [
  {
    championshipId: "24272",
    seasonLabel: "Season 1",
    classes: [
      { classId: "113467", classLabel: "LMP2 ELMS" },
      { classId: "113468", classLabel: "LMGT3" },
    ],
  },
  {
    championshipId: "26645",
    seasonLabel: "Season 2",
    classes: [
      { classId: "136108", classLabel: "Hypercar" },
      { classId: "136109", classLabel: "LMGT3" },
    ],
  },
];
const SESSION_TYPES = [
  { sessionType: "qualifying", sessionName: "Qualifying" },
  { sessionType: "race_1", sessionName: "Race 1" },
  { sessionType: "race_2", sessionName: "Race 2" },
];
// --------------------------------------------------------------

async function fetchHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000); // 20s per request
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; results-sync-bot/1.0)" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Fetch failed (${res.status}): ${url}`);
    return await res.text();
  } catch (err) {
    if (err.name === "AbortError") throw new Error(`Timed out after 20s: ${url}`);
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadExistingData() {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf-8");
    const data = JSON.parse(raw);
    data.sessions = data.sessions || [];
    // processedRaces is keyed by championshipId so each season's "already
    // seen" list is independent — a new season starting never affects an
    // older one's tracking.
    data.processedRaces = data.processedRaces && typeof data.processedRaces === "object" && !Array.isArray(data.processedRaces)
      ? data.processedRaces
      : {}; // handles the old flat-array format from before multi-season support
    return data;
  } catch {
    return { sessions: [], processedRaces: {} };
  }
}

async function fetchSessionForAllClasses(baseUrl, classes, raceId, roundId, sessionType) {
  const classResults = [];
  let anyRowsFound = false;

  for (const { classId, classLabel } of classes) {
    const roundParam = roundId ? `&round_id=${roundId}` : "";
    const url = `${baseUrl}/results?race_id=${raceId}${roundParam}&session_type=${sessionType}&filter_class_id=${classId}&overall=false`;
    let html;
    try {
      html = await fetchHtml(url);
    } catch (err) {
      console.log(`  (skipping ${classLabel}/${sessionType}: ${err.message})`);
      continue;
    }
    const rows = parseSimGridResultsTable(html, { classLabel, isRace: sessionType.startsWith("race") });
    if (rows.length > 0) anyRowsFound = true;
    classResults.push({ classId, classLabel, rows });
  }

  return anyRowsFound ? classResults : null;
}

async function syncChampionship(championship, data, seasonOrder) {
  const { championshipId, seasonLabel, classes } = championship;
  const baseUrl = `https://www.thesimgrid.com/championships/${championshipId}`;
  const processed = new Set(data.processedRaces[championshipId] || []);

  console.log(`\n=== ${seasonLabel} (championship ${championshipId}) ===`);
  console.log("Fetching races list...");
  const racesHtml = await fetchHtml(`${baseUrl}/races`);
  const allRaces = parseRacesPage(racesHtml);
  const newRaces = allRaces.filter((r) => !processed.has(r.raceId));

  if (newRaces.length === 0) {
    console.log("No new races with published results.");
    data.processedRaces[championshipId] = Array.from(processed);
    return;
  }

  console.log(`Found ${newRaces.length} new race(s): ${newRaces.map((r) => r.label).join(", ")}`);

  for (const race of newRaces) {
    for (const { sessionType, sessionName } of SESSION_TYPES) {
      console.log(`Fetching ${race.label} — ${sessionName}...`);
      const classResults = await fetchSessionForAllClasses(baseUrl, classes, race.raceId, race.roundId, sessionType);
      if (!classResults) {
        console.log(`  (no ${sessionName} data — likely doesn't exist for this round)`);
        continue;
      }
      const summary = buildSessionSummary(classResults, {
        raceId: race.raceId,
        roundId: race.roundId,
        roundLabel: race.label,
        sessionType,
        sessionName,
        championshipName: seasonLabel,
        season: seasonLabel,
        seasonOrder,
      });
      data.sessions.push(summary);
    }
    processed.add(race.raceId);
  }

  data.processedRaces[championshipId] = Array.from(processed);
}

async function main() {
  const data = await loadExistingData();

  for (let i = 0; i < CHAMPIONSHIPS.length; i++) {
    try {
      await syncChampionship(CHAMPIONSHIPS[i], data, i);
    } catch (err) {
      // One championship failing (e.g. a network hiccup) shouldn't stop the
      // others from syncing.
      console.error(`Error syncing ${CHAMPIONSHIPS[i].seasonLabel}:`, err.message);
    }
  }

  data.lastSync = new Date().toISOString();
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
