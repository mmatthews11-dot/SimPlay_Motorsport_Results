// Parses a single ACC "results" JSON (as written by the dedicated server / G-Portal)
// into a compact, front-end-friendly summary.
//
// ACC writes one file per session (Free Practice / Qualifying / Race) with names
// like "250101_190000_FP.json". The schema is documented informally in Kunos'
// "ACC Server Admin Handbook" (see the "Result files" appendix).

// Best-effort car model ID -> name lookup. ACC's numeric carModel IDs are stable
// across servers but Kunos doesn't publish a single canonical list, so this only
// covers common GT3 cars. Extend it if you spot an "Unknown car" in the output.
const CAR_MODELS = {
  0: "Porsche 991 GT3 R",
  1: "Mercedes-AMG GT3",
  2: "Ferrari 488 GT3",
  3: "Audi R8 LMS",
  4: "Lamborghini Huracán GT3",
  5: "McLaren 650S GT3",
  6: "Nissan GT-R Nismo GT3",
  7: "BMW M6 GT3",
  8: "Bentley Continental GT3 2018",
  9: "Porsche 991 II GT3 Cup",
  10: "Nissan GT-R Nismo GT3 2015",
  11: "Bentley Continental GT3 2015",
  12: "Aston Martin V12 Vantage GT3",
  13: "Lamborghini Gallardo (Reiter) R-EX",
  14: "Jaguar G3"
  15: "Lexus RC F GT3",
  16: "Lamborghini Huracán Evo 2019 GT3",
  17: "Honda NSX GT3",
  18: "Lamborghini Huracán SuperTrofeo",
  19: "Audi R8 LMS Evo",
  20: "Aston Martin V8 Vantage GT3",
  21: "Honda NSX Evo GT3",
  22: "McLaren 720S GT3",
  23: "Porsche 991 II GT3 R",
  24: "Ferrari 488 GT3 Evo",
  25: "Mercedes-AMG GT3 2020",
  26: "BMW M4 GT3",
  27: "BMW M2 CS Racing",
  28: "Porsche 992 GT3 Cup",
  29: "Lamborghini Huracán SuperTrofeo EVO2",
  31: "Audi R8 LMS Evo II",
  32: "Ferrari 296 GT3",
  33: "Lamborghini Huracán Evo2 GT3",
  34: "Porsche 992 GT3 R",
  35: "McLaren 720S GT3 Evo 2023",
  36: "Ford Mustang GT3",
};

const SESSION_NAMES = { FP: "Practice", Q: "Qualifying", Q1: "Qualifying 1", Q2: "Qualifying 2", R: "Race", R1: "Race 1", R2: "Race 2" };

function msToTime(ms) {
  if (ms == null || ms < 0) return null;
  const totalMs = Math.round(ms);
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function msToGap(ms) {
  if (ms == null) return null;
  if (ms <= 0) return "-";
  const totalMs = Math.round(ms);
  const minutes = Math.floor(totalMs / 60000);
  const seconds = ((totalMs % 60000) / 1000).toFixed(3);
  return minutes > 0 ? `+${minutes}:${seconds.padStart(6, "0")}` : `+${seconds}`;
}

function driverName(driver) {
  if (!driver) return "Unknown driver";
  return [driver.firstName, driver.lastName].filter(Boolean).join(" ").trim() || driver.shortName || "Unknown driver";
}

function carLabel(car) {
  const model = CAR_MODELS[car.carModel] || `Car #${car.carModel}`;
  return car.carGroup ? `${model} (${car.carGroup})` : model;
}

/**
 * @param {object} raw - parsed JSON contents of an ACC results file
 * @param {string} sourceFile - original filename, used to derive a stable session id
 */
export function parseAccResults(raw, sourceFile = "") {
  const sessionType = raw.sessionType || "?";
  const lines = raw.sessionResult?.leaderBoardLines || [];
  const isRace = sessionType.startsWith("R");

  // ACC already orders leaderBoardLines by finishing position for races and by
  // best lap for practice/qualifying, so we trust that order for position numbers.
  const leaderTiming = lines[0]?.timing;

  const standings = lines.map((line, index) => {
    const timing = line.timing || {};
    const referenceTime = isRace ? timing.totalTime : timing.bestLap;
    const leaderTime = isRace ? leaderTiming?.totalTime : leaderTiming?.bestLap;
    const gapMs = referenceTime != null && leaderTime != null ? referenceTime - leaderTime : null;

    return {
      position: index + 1,
      raceNumber: line.car?.raceNumber ?? null,
      driver: driverName(line.currentDriver),
      allDrivers: (line.car?.drivers || []).map(driverName),
      car: carLabel(line.car || {}),
      teamName: line.car?.teamName || null,
      laps: timing.lapCount ?? null,
      bestLap: msToTime(timing.bestLap),
      bestLapMs: timing.bestLap ?? null,
      lastLap: msToTime(timing.lastLap),
      gap: index === 0 ? "-" : msToGap(gapMs),
      hasMandatoryPitstopIssue: (line.missingMandatoryPitstop ?? -1) > 0,
    };
  });

  const fastestLap = standings.reduce((best, s) => {
    if (s.bestLapMs == null) return best;
    if (!best || s.bestLapMs < best.bestLapMs) return s;
    return best;
  }, null);

  return {
    id: sourceFile.replace(/\.json$/i, "") || `${raw.trackName}-${sessionType}-${Date.now()}`,
    sourceFile,
    sessionType,
    sessionName: SESSION_NAMES[sessionType] || sessionType,
    trackName: raw.trackName || "Unknown track",
    serverName: raw.serverName || null,
    raceWeekendIndex: raw.raceWeekendIndex ?? null,
    isWetSession: !!raw.sessionResult?.isWetSession,
    fastestLapDriver: fastestLap?.driver ?? null,
    fastestLapTime: fastestLap?.bestLap ?? null,
    penaltyCount: (raw.penalties || []).length,
    standings,
  };
}
