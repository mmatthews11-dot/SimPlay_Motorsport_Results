// Discovers new races on a SimGrid championship, fetches each class's results
// for each session, merges them, and updates data/results.json.
//
// This file is SHARED with the ACC/G-Portal sync script — both write to the
// same data/results.json, each tagging its sessions with a `game` field
// ("ACC" or "LMU"). This script only ever touches LMU sessions and its own
// `processedRaces` manifest; it must never delete or overwrite ACC sessions
// or the ACC sync's `processedFiles` manifest.
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
const DATA_FILE = path.join(__dirname, "..", "data", "results.json");

// ---- Configuration specific to this championship ----
// Update these if you point this at a different championship/season, or if
// SimGrid changes the class IDs for a new season of the same championship
// (check the "Split" filter dropdown on a results page to find them).
const CHAMPIONSHIP_ID = "24272";
const CHAMPIONSHIP_NAME = "LMP2 ELMS/LMGT3 Season 1";
const CLASSES = [
  { classId: "113467", classLabel: "LMP2 ELMS" },
  { classId: "113468", classLabel: "LMGT3" },
];
const SESSION_TYPES = [
  { sessionType: "qualifying", sessionName: "Qualifying" },
  { sessionType: "race_1", sessionName: "Race 1" },
  { sessionType: "race_2", sessionName: "Race 2" },
];
// ------------------------------------------------------

const BASE_URL = `https://www.thesimgrid.com/championships/${CHAMPIONSHIP_ID}`;

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
    return JSON.parse(raw);
  } catch {
    return { sessions: [] };
  }
}

async function fetchSessionForAllClasses(raceId, roundId, sessionType) {
  const classResults = [];
  let anyRowsFound = false;

  for (const { classId, classLabel } of CLASSES) {
    const url = `${BASE_URL}/results?race_id=${raceId}&round_id=${roundId}&session_type=${sessionType}&filter_class_id=${classId}&overall=false`;
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

async function main() {
  const data = await loadExistingData();
  data.sessions = data.sessions || [];
  const processed = new Set(data.processedRaces || []);

  console.log("Fetching races list...");
  const racesHtml = await fetchHtml(`${BASE_URL}/races`);
  const allRaces = parseRacesPage(racesHtml);
  const newRaces = allRaces.filter((r) => !processed.has(r.raceId));

  if (newRaces.length === 0) {
    console.log("No new races with published results.");
    data.lastSyncLmu = new Date().toISOString();
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
    return;
  }

  console.log(`Found ${newRaces.length} new race(s): ${newRaces.map((r) => r.label).join(", ")}`);

  for (const race of newRaces) {
    for (const { sessionType, sessionName } of SESSION_TYPES) {
      console.log(`Fetching ${race.label} — ${sessionName}...`);
      const classResults = await fetchSessionForAllClasses(race.raceId, race.roundId, sessionType);
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
        championshipName: CHAMPIONSHIP_NAME,
      });
      data.sessions.push(summary);
    }
    processed.add(race.raceId);
  }

  data.processedRaces = Array.from(processed);
  data.lastSyncLmu = new Date().toISOString();

  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
