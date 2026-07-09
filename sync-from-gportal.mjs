// Connects to the G-Portal ACC server over SFTP, downloads any results files we
// haven't seen yet, parses them, and updates data/results.json.
//
// Required environment variables (set these as GitHub Actions secrets, or in a
// local .env file if running by hand):
//   GPORTAL_HOST      - SFTP host, e.g. eu123.g-portal.com
//   GPORTAL_PORT      - SFTP port (G-Portal uses a non-standard port, check your panel)
//   GPORTAL_USERNAME
//   GPORTAL_PASSWORD
//   GPORTAL_RESULTS_PATH - remote path to the "results" folder, e.g.
//                           /config/results  (varies by server, check via an FTP client first)

import SftpClient from "ssh2-sftp-client";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseAccResults } from "./parse-acc-results.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "..", "data", "results.json");
const TMP_DIR = path.join(__dirname, "..", ".tmp-downloads");

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
    return { sessions: [], processedFiles: [] };
  }
}

async function main() {
  const host = requireEnv("GPORTAL_HOST");
  const port = Number(process.env.GPORTAL_PORT || 2022);
  const username = requireEnv("GPORTAL_USERNAME");
  const password = requireEnv("GPORTAL_PASSWORD");
  const remoteResultsPath = requireEnv("GPORTAL_RESULTS_PATH");

  const data = await loadExistingData();
  const processed = new Set(data.processedFiles || []);

  const sftp = new SftpClient();
  await sftp.connect({ host, port, username, password });

  try {
    // ACC names result files "<date>_<time>_<TYPE>.json" where TYPE is
    // FP (practice), Q / Q1 / Q2 (qualifying), or R / R1 / R2 (race).
    // We only care about qualifying and race results, so practice files are
    // skipped entirely — but still marked as "seen" so we don't re-check them.
    const QUALI_OR_RACE = /_((Q|R)\d*)\.json$/i;

    const remoteFiles = await sftp.list(remoteResultsPath);
    const allNewFiles = remoteFiles
      .filter((f) => f.type === "-" && f.name.toLowerCase().endsWith(".json"))
      .filter((f) => !processed.has(f.name))
      .sort((a, b) => a.name.localeCompare(b.name));

    const skippedPractice = allNewFiles.filter((f) => !QUALI_OR_RACE.test(f.name));
    const newJsonFiles = allNewFiles.filter((f) => QUALI_OR_RACE.test(f.name));

    // Mark practice files as processed so they're not re-evaluated every run.
    skippedPractice.forEach((f) => processed.add(f.name));
    if (skippedPractice.length > 0) {
      console.log(`Skipping ${skippedPractice.length} practice file(s): ${skippedPractice.map((f) => f.name).join(", ")}`);
    }

    if (newJsonFiles.length === 0) {
      console.log("No new qualifying/race result files.");
      // Still persist processedFiles so skipped practice files stay skipped.
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
      await sftp.get(remotePath, localPath);

      const raw = JSON.parse(decodeAccJson(await fs.readFile(localPath)));
      const summary = parseAccResults(raw, file.name);
      data.sessions.push(summary);
      processed.add(file.name);
    }

    // Newest sessions first for display purposes.
    data.sessions.sort((a, b) => (a.sourceFile < b.sourceFile ? 1 : -1));
    data.processedFiles = Array.from(processed);
    data.lastSync = new Date().toISOString();

    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
    console.log(`Added ${newJsonFiles.length} new session(s).`);
  } finally {
    await sftp.end();
    await fs.rm(TMP_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
