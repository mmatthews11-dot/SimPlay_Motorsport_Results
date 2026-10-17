// Connects to the G-Portal ACC server over plain FTP (G-Portal's "SFTP Access"
// panel is misleadingly named — it's actually vanilla FTP, no TLS), downloads
// any results files we haven't seen yet, parses them, and updates
// data/acc-results.json.
//
// This has its OWN dedicated data file, separate from the LMU/SimGrid sync's
// data/lmu-results.json. They used to share one file, but that meant two
// independently-scheduled workflows writing to the same file could hit git
// merge conflicts if their runs overlapped (which happened in practice).
// Keeping them fully separate makes that structurally impossible.
//
// Required environment variables (set these as GitHub Actions secrets, or in a
// local .env file if running by hand):
//   GPORTAL_HOST      - FTP host, e.g. 176.57.174.147
//   GPORTAL_PORT       - FTP port from your G-Portal panel, e.g. 30221
//   GPORTAL_USERNAME
//   GPORTAL_PASSWORD
//   GPORTAL_RESULTS_PATH - remote path to the "results" folder, e.g. /results

import { Client } from "basic-ftp";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseAccResults } from "./parse-acc-results.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "..", "data", "acc-results.json");
const TMP_DIR = path.join(__dirname, "..", ".tmp-downloads-acc");

// Re-pull option. Set this to a date in YYMMDD form (the same prefix ACC uses
// in its result filenames, e.g. "261001" for 1 Oct 2026) to re-download and
// re-parse every qualifying/race file from that date onward, replacing the
// stored sessions IN PLACE. Anything dated before it is left exactly as it is,
// and a session is only replaced once its file has been downloaded
// successfully — if a file is no longer on the server, the stored version stays.
// Use it after changing something that's applied when a file is parsed (driver
// classes, car names...). It runs once per value (recorded in the data file as
// `repulledFrom`), so it's safe to leave set; change the date to run it again.
// Leave as "" for normal operation.
const REPULL_FROM = "261001";

// Replaces an existing session with the same id, or adds it if it's new, so
// re-pulling a file can never create a duplicate.
function upsertSession(sessions, summary) {
  const index = sessions.findIndex((s) => s.id === summary.id);
  if (index >= 0) sessions[index] = summary;
  else sessions.push(summary);
}

// ACC writes result files as UTF-16LE (with a byte-order-mark), not UTF-8.
// Reading them as plain UTF-8 text produces garbage / breaks JSON.parse.
function decodeAccJson(buffer) {
  const hasBom = buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe;
  return buffer.toString("utf16le", hasBom ? 2 : 0);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function loadExistingData() {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { sessions: [] };
  }
}

async function main() {
  const host = requireEnv("GPORTAL_HOST");
  const port = Number(process.env.GPORTAL_PORT || 21);
  const user = requireEnv("GPORTAL_USERNAME");
  const password = requireEnv("GPORTAL_PASSWORD");
  const remoteResultsPath = requireEnv("GPORTAL_RESULTS_PATH");

  const data = await loadExistingData();
  data.sessions = data.sessions || [];
  const processed = new Set(data.processedFiles || []);

  const client = new Client();
  // G-Portal's FTP server rejects AUTH TLS/SSL outright, so this has to be
  // plain FTP. Don't set secure: true here or the connection will fail.
  await client.access({ host, port, user, password, secure: false });

  try {
    // ACC names result files "<date>_<time>_<TYPE>.json" where TYPE is
    // FP (practice), Q / Q1 / Q2 (qualifying), or R / R1 / R2 (race).
    // We only care about qualifying and race results.
    const QUALI_OR_RACE = /_((Q|R)\d*)\.json$/i;

    // Files dated REPULL_FROM or later get re-processed even though they're
    // already in `processed` (qualifying/race files only — practice files are
    // never turned into sessions, so there's nothing to redo for them).
    const repullActive = /^\d{6}$/.test(REPULL_FROM) && data.repulledFrom !== REPULL_FROM;
    const needsRepull = (name) =>
      repullActive && QUALI_OR_RACE.test(name) && name.slice(0, 6) >= REPULL_FROM;

    const remoteFiles = await client.list(remoteResultsPath);
    const allNewFiles = remoteFiles
      .filter((f) => f.isFile && f.name.toLowerCase().endsWith(".json"))
      .filter((f) => !processed.has(f.name) || needsRepull(f.name))
      .sort((a, b) => a.name.localeCompare(b.name));

    const skippedPractice = allNewFiles.filter((f) => !QUALI_OR_RACE.test(f.name));
    const newJsonFiles = allNewFiles.filter((f) => QUALI_OR_RACE.test(f.name));

    skippedPractice.forEach((f) => processed.add(f.name));
    if (skippedPractice.length > 0) {
      console.log(`Skipping ${skippedPractice.length} practice file(s): ${skippedPractice.map((f) => f.name).join(", ")}`);
    }

    if (newJsonFiles.length === 0) {
      console.log("No new qualifying/race result files.");
      data.processedFiles = Array.from(processed);
      await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
      await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
      return;
    }

    await fs.mkdir(TMP_DIR, { recursive: true });

    for (const file of newJsonFiles) {
      const remotePath = `${remoteResultsPath.replace(/\/$/, "")}/${file.name}`;
      const localPath = path.join(TMP_DIR, file.name);
      console.log(`Downloading ${file.name}...`);
      await client.downloadTo(localPath, remotePath);

      const raw = JSON.parse(decodeAccJson(await fs.readFile(localPath)));
      const summary = parseAccResults(raw, file.name);
      upsertSession(data.sessions, summary);
      processed.add(file.name);
    }

    if (repullActive) {
      // Anything in range that wasn't on the server this time keeps its old
      // stored version — say so, so it isn't a silent surprise.
      const refreshed = new Set(newJsonFiles.map((f) => f.name));
      const kept = data.sessions
        .filter((x) => x.sourceFile && x.sourceFile.slice(0, 6) >= REPULL_FROM && !refreshed.has(x.sourceFile))
        .map((x) => x.sourceFile);
      if (kept.length) {
        console.log(`Re-pull from ${REPULL_FROM}: ${kept.length} stored session(s) had no file on the server, left as they were: ${kept.join(", ")}`);
      }
      data.repulledFrom = REPULL_FROM;
    }

    // Sort only within display — LMU sessions use a different id scheme, so
    // this ordering only meaningfully affects how ACC sessions are grouped;
    // the dashboard filters by game before rendering tabs anyway.
    data.processedFiles = Array.from(processed);
    data.lastSync = new Date().toISOString();

    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
    console.log(`Added or updated ${newJsonFiles.length} session(s).`);
  } finally {
    client.close();
    await fs.rm(TMP_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
