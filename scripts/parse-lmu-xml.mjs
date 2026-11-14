// Parses a Le Mans Ultimate results file (the game's XML — LMU uses the
// rFactor 2 engine, so this is the rFactor 2 results format) into a session
// summary shaped like the rest of the LMU data, plus extra pace/sector stats.
//
// Deliberately dependency-free: the file is machine generated and very
// regular, so a small purpose-built reader is enough and works anywhere Node
// does. It is lenient about missing fields, because DNF/DNS drivers have
// several of them missing (no FinishTime, sometimes no BestLapTime).
//
// What the file looks like (only the parts used here):
//   <RaceResults> ...track info... <Race> or <Qualify>
//       <DateTime>epoch seconds</DateTime> <Minutes> ...
//       <Stream> ...incidents... </Stream>
//       <Driver> <Name> <CarClass> <CarType> <CarNumber> <GridPos> <Position>
//                <ClassGridPos> <ClassPosition> <BestLapTime> <FinishTime>
//                <Laps> <Pitstops> <FinishStatus> <DNFReason>
//                <Lap num= p= et= s1= s2= s3= topspeed= rcompound= [pit="1"]>lap time</Lap> ...
//       </Driver> ...

const CLASS_LABELS = { Hyper: "Hypercar", GT3: "LMGT3" };

// A lap counts towards "clean race pace" unless it is lap 1, a pit lap, the
// lap after a pit lap (it contains the stop), has no time, or is slower than
// this multiple of the driver's own median clean lap (spins, safety car...).
const PACE_CUTOFF = 1.07;
const PACE_MIN_LAPS = 3;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}>([^<]*)</${name}>`));
  return m ? decode(m[1]).trim() : null;
}
const toInt = (v) => (v != null && /^-?\d+$/.test(v) ? parseInt(v, 10) : null);
const toNum = (v) => (v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
// Seconds as written in the file ("84.3725") -> whole milliseconds, rounding
// half up on the 4th decimal. Done on the digits themselves rather than with
// floating-point maths, which can round an exact tie either way.
const secToMs = (v) => {
  if (v == null || !/^\d+(\.\d+)?$/.test(v)) return null;
  const [whole, frac = ""] = v.split(".");
  let ms = parseInt(whole, 10) * 1000 + parseInt((frac + "000").slice(0, 3), 10);
  if (frac.length > 3 && frac[3] >= "5") ms += 1;
  return ms > 0 ? ms : null;
};

export function msToLap(ms) {
  if (ms == null) return null;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}.${String(Math.round(ms % 1000)).padStart(3, "0")}`;
}
function msToTotal(ms) {
  const h = Math.floor(ms / 3600000);
  const rest = msToLap(ms % 3600000);
  return h > 0 ? `${h}:${rest.padStart(9, "0")}` : rest;
}
function gapText(ms) {
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(3);
  return m > 0 ? `+${m}:${s.padStart(6, "0")}` : `+${s}`;
}

export function parseLaps(driverBlock) {
  const laps = [];
  for (const m of driverBlock.matchAll(/<Lap\s([^>]*?)(?:\/>|>([^<]*)<\/Lap>)/g)) {
    const a = {};
    for (const x of m[1].matchAll(/([\w:-]+)="([^"]*)"/g)) a[x[1]] = decode(x[2]);
    const text = (m[2] ?? "").trim();
    laps.push({
      num: toInt(a.num),
      ms: /^\d+(\.\d+)?$/.test(text) ? secToMs(text) : null, // "--.----" = no time
      s1: secToMs(a.s1),
      s2: secToMs(a.s2),
      s3: secToMs(a.s3),
      pit: a.pit != null && a.pit !== "0",
      topSpeed: toNum(a.topspeed),
      tyre: a.rcompound ? a.rcompound.split(",").pop().trim() : null,
    });
  }
  return laps;
}

function median(sorted) {
  const n = sorted.length;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

function racePace(laps) {
  const pitNums = new Set(laps.filter((l) => l.pit).map((l) => l.num));
  const clean = laps
    .filter((l) => l.ms != null && l.num !== 1 && !pitNums.has(l.num) && !pitNums.has(l.num - 1))
    .map((l) => l.ms);
  if (clean.length < PACE_MIN_LAPS) return { avgPaceMs: null, paceLapsUsed: clean.length, consistencyMs: null };
  const limit = median([...clean].sort((a, b) => a - b)) * PACE_CUTOFF;
  const kept = clean.filter((ms) => ms <= limit);
  const mean = kept.reduce((a, b) => a + b, 0) / kept.length;
  const variance = kept.reduce((a, b) => a + (b - mean) ** 2, 0) / kept.length;
  return {
    avgPaceMs: Math.round(mean),
    paceLapsUsed: kept.length,
    consistencyMs: Math.round(Math.sqrt(variance)),
  };
}

function sectorBests(laps) {
  const timed = laps.filter((l) => l.ms != null);
  const min = (key) => {
    const v = timed.map((l) => l[key]).filter((x) => x != null);
    return v.length ? Math.min(...v) : null;
  };
  const b = { bestS1Ms: min("s1"), bestS2Ms: min("s2"), bestS3Ms: min("s3") };
  b.idealLapMs = b.bestS1Ms && b.bestS2Ms && b.bestS3Ms ? b.bestS1Ms + b.bestS2Ms + b.bestS3Ms : null;
  return b;
}

function tyreStints(laps) {
  const seq = [];
  for (const l of laps) if (l.tyre && seq[seq.length - 1] !== l.tyre) seq.push(l.tyre);
  return seq.join(" › ") || null;
}

function statusOf(finishStatus, lapCount) {
  const fs = (finishStatus || "").toLowerCase();
  if (/dq|disq/.test(fs)) return "DSQ";
  if (lapCount === 0) return "DNS";
  return fs.startsWith("finished") ? "FINISHED" : "DNF";
}

/**
 * @param {string} xml  the file contents
 * @param {object} meta { season, seasonOrder, roundLabel, sourceFile }
 * @returns the session summary, or null if the file has no race/qualifying session
 */
export function parseLmuXml(xml, meta = {}) {
  const sessionMatch = xml.match(/<(Race|Qualify\d*)>([\s\S]*?)<\/\1>/);
  if (!sessionMatch) return null;
  const isRace = sessionMatch[1] === "Race";
  const block = sessionMatch[2];

  const epoch = toInt(tag(block, "DateTime"));
  const startDate = epoch != null ? new Date(epoch * 1000) : null;

  const rows = [];
  for (const dm of block.matchAll(/<Driver(?:\s[^>]*)?>([\s\S]*?)<\/Driver>/g)) {
    const d = dm[1];
    const laps = parseLaps(d);
    const lapCount = toInt(tag(d, "Laps")) ?? laps.length;
    const status = statusOf(tag(d, "FinishStatus"), lapCount);
    const bestLapMs = secToMs(tag(d, "BestLapTime"));
    const finishMs = secToMs(tag(d, "FinishTime"));
    const rawClass = tag(d, "CarClass") || "Unclassified";
    const classGrid = toInt(tag(d, "ClassGridPos"));
    const classPos = toInt(tag(d, "ClassPosition"));

    const speeds = laps.map((l) => l.topSpeed).filter((x) => x != null);
    rows.push({
      position: classPos, // the dashboard shows each class on its own, so "position" is the class position
      overallPosition: toInt(tag(d, "Position")),
      classPosition: classPos,
      driverClass: CLASS_LABELS[rawClass] ?? rawClass,
      raceNumber: tag(d, "CarNumber"),
      // Some in-game names carry a leftover Discord-style tag ("Name#6649"); drop it.
      driver: (tag(d, "Name") || "Unknown driver").replace(/\s*#\d{3,5}$/, ""),
      car: tag(d, "CarType") || tag(d, "VehName"),
      laps: lapCount,
      bestLap: msToLap(bestLapMs),
      bestLapMs,
      referenceTimeMs: bestLapMs,
      totalTimeDisplay: isRace && status === "FINISHED" && finishMs != null ? msToTotal(finishMs) : null,
      gapDisplay: null, // filled in below, per class
      status,
      statusNote: status === "DNF" ? tag(d, "DNFReason") : null,
      hasMandatoryPitstopIssue: false,
      pitstops: toInt(tag(d, "Pitstops")),
      topSpeed: speeds.length ? Math.round(Math.max(...speeds) * 10) / 10 : null,
      ...sectorBests(laps),
      ...(isRace
        ? {
            gridPosition: classGrid,
            positionsGained: status === "FINISHED" && classGrid != null && classPos != null ? classGrid - classPos : null,
            tyres: tyreStints(laps),
            ...racePace(laps),
            _finishMs: finishMs, // internal, removed below
          }
        : {}),
    });
  }
  if (!rows.length) return null;

  // Group by class (Hypercar first = the class of the best overall finisher),
  // each class in its own finishing order.
  const byClass = new Map();
  for (const r of rows.slice().sort((a, b) => (a.overallPosition ?? 1e9) - (b.overallPosition ?? 1e9))) {
    if (!byClass.has(r.driverClass)) byClass.set(r.driverClass, []);
    byClass.get(r.driverClass).push(r);
  }
  const standingsByClass = {};
  for (const [cls, list] of byClass) {
    list.sort((a, b) => (a.classPosition ?? 1e9) - (b.classPosition ?? 1e9));
    const leader = list[0];
    const leaderFinishMs = leader._finishMs ?? null; // read before any row's internal field is cleared
    const bestPace = Math.min(...list.map((r) => r.avgPaceMs ?? Infinity));
    for (const r of list) {
      if (r !== leader && r.status === "FINISHED") {
        if (isRace) {
          const down = leader.laps - r.laps;
          if (down >= 1) r.gapDisplay = `+${down} Lap${down > 1 ? "s" : ""}`;
          else if (r._finishMs != null && leaderFinishMs != null) r.gapDisplay = gapText(r._finishMs - leaderFinishMs);
        } else if (r.bestLapMs != null && leader.bestLapMs != null) {
          r.gapDisplay = gapText(r.bestLapMs - leader.bestLapMs);
        }
      }
    }
    for (const r of list) {
      if (isRace) {
        r.paceGapMs = r.avgPaceMs != null && Number.isFinite(bestPace) ? r.avgPaceMs - bestPace : null;
        delete r._finishMs;
      }
    }
    standingsByClass[cls] = list;
  }

  const fastest = rows.filter((r) => r.bestLapMs != null).sort((a, b) => a.bestLapMs - b.bestLapMs)[0];
  const fileName = (meta.sourceFile || "").split("/").pop();
  const sessionNo = (fileName.match(/\d*[QR](\d)_/i) || [])[1];
  const nameFromFile = isRace
    ? `Race ${sessionNo || 1}`
    : sessionNo && sessionNo !== "1"
      ? `Qualifying ${sessionNo}`
      : "Qualifying";

  const venue = tag(xml, "TrackVenue");
  const fileTrack = (fileName.match(/\d*[QR]\d+_(.+?)(?:_Quali(?:fy)?)?\.xml$/i) || [])[1];

  return {
    id: `xml-${(meta.sourceFile || fileName).toLowerCase().replace(/\.xml$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
    game: "LMU",
    source: "xml",
    season: meta.season ?? null,
    seasonOrder: meta.seasonOrder ?? 0,
    sourceFile: meta.sourceFile ?? fileName,
    sessionType: isRace ? "R" : "Q",
    sessionName: nameFromFile,
    trackName: meta.roundLabel || fileTrack?.replace(/_/g, " ") || venue || "Unknown track",
    serverName: meta.season ?? null,
    eventName: tag(xml, "TrackEvent"),
    venue,
    startTime: startDate ? startDate.toISOString() : null,
    sessionDate: startDate
      ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" }).format(startDate)
      : null,
    raceMinutes: toInt(tag(block, "Minutes")),
    mostLaps: toInt(tag(block, "MostLapsCompleted")),
    isWetSession: false,
    fastestLapDriver: fastest?.driver ?? null,
    fastestLapTime: fastest?.bestLap ?? null,
    totalDrivers: rows.length,
    standingsByClass,
  };
}
