// Reads every LMU results XML file under lmu-imports/ and rebuilds
// data/lmu-imports.json from scratch.
//
// Folder layout (the folder names become what shows on the dashboard):
//
//   lmu-imports/
//     Season 2/
//       Round 1 Interlagos/          <- shown as the round name
//         2026_09_08_20_24_35-96Q1_Interlagos_Quali.xml
//         2026_09_08_22_09_32-25R1_Interlagos.xml
//       Round 2 Imola/
//         ...
//
// It rebuilds everything on each run rather than tracking "already seen"
// files, so there is no list to get out of step: add a file, replace a file
// with a corrected one, or delete a file, and the output simply follows. If
// the same session appears twice in a round (e.g. a corrected re-upload), the
// later one wins.
//
// This writes only data/lmu-imports.json, a file no other workflow touches, so
// it can never clash with the ACC or SimGrid syncs.

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseLmuXml } from "./parse-lmu-xml.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const IMPORT_DIR = path.join(ROOT, "lmu-imports");
const OUT_FILE = path.join(ROOT, "data", "lmu-imports.json");

const warn = (msg) => console.log(`::warning::${msg}`); // shows as a yellow note on the Actions run

async function findXmlFiles(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...(await findXmlFiles(full)));
    else if (e.name.toLowerCase().endsWith(".xml")) files.push(full);
  }
  return files.sort();
}

function decodeFile(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString("utf16le", 2);
  return buf.toString("utf8").replace(/^\uFEFF/, "");
}

// "season 2", "Season 2 " -> "Season 2" so it always matches the season label
// used by the SimGrid data.
function canonicalSeason(name) {
  const m = name.trim().match(/^season\s*(\d+)$/i);
  return m ? `Season ${parseInt(m[1], 10)}` : name.trim();
}
const seasonOrderOf = (season) => {
  const m = season.match(/(\d+)/);
  return m ? parseInt(m[1], 10) - 1 : 99;
};

async function main() {
  const files = await findXmlFiles(IMPORT_DIR);
  console.log(`Found ${files.length} XML file(s) in lmu-imports/`);

  const found = [];
  for (const file of files) {
    const rel = path.relative(IMPORT_DIR, file).split(path.sep);
    const relPath = rel.join("/");
    if (rel.length < 2) {
      warn(`${relPath}: skipped — put it inside a season folder, e.g. lmu-imports/Season 2/Round 1 Interlagos/`);
      continue;
    }
    const season = canonicalSeason(rel[0]);
    const roundLabel = rel.length >= 3 ? rel[1].trim() : undefined;
    try {
      const xml = decodeFile(await fs.readFile(file));
      const session = parseLmuXml(xml, { season, seasonOrder: seasonOrderOf(season), roundLabel, sourceFile: relPath });
      if (!session) {
        warn(`${relPath}: skipped — no race or qualifying session found in this file`);
        continue;
      }
      console.log(`  ✓ ${season} / ${session.trackName} — ${session.sessionName} (${session.totalDrivers} drivers)`);
      found.push(session);
    } catch (err) {
      warn(`${relPath}: skipped — could not be read (${err.message})`);
    }
  }

  // If the same session appears more than once in a round, keep the latest.
  const byKey = new Map();
  for (const s of found) {
    const key = `${s.season}|${s.trackName}|${s.sessionName}`;
    const existing = byKey.get(key);
    if (!existing || (s.startTime ?? "") > (existing.startTime ?? "")) {
      if (existing) warn(`${existing.sourceFile}: replaced by the later file ${s.sourceFile} (same session)`);
      byKey.set(key, s);
    } else {
      warn(`${s.sourceFile}: ignored — a later file for the same session exists (${existing.sourceFile})`);
    }
  }

  const sessions = [...byKey.values()].sort(
    (a, b) => (b.startTime ?? "").localeCompare(a.startTime ?? "") || a.sourceFile.localeCompare(b.sourceFile)
  );

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(
    OUT_FILE,
    JSON.stringify({ sessions, files: files.map((f) => path.relative(IMPORT_DIR, f).split(path.sep).join("/")), lastSync: new Date().toISOString() })
  );
  console.log(`Wrote ${sessions.length} session(s) to data/lmu-imports.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
